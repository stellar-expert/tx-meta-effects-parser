const {StrKey, hash, nativeToScVal} = require('@stellar/stellar-sdk')
const effectTypes = require('./effect-types')
const {validateAmount, normalizeAddress, parseLargeInt} = require('./parser/normalization')
const {parseLedgerEntryChanges} = require('./parser/ledger-entry-changes-parser')
const {
    xdrParseAsset,
    xdrParseAccountAddress,
    xdrParseScAddress,
    xdrParseScVal,
    xdrParseSacBalanceChange,
    xdrParseHex,
    xdrParseBase64
} = require('./parser/tx-xdr-parser-utils')
const {contractIdFromPreimage} = require('./parser/contract-preimage-encoder')
const {generateContractCodeEntryHash} = require('./parser/ledger-key')
const {analyzeSignerChanges} = require('./aggregation/signer-changes-analyzer')
const EventsAnalyzer = require('./aggregation/events-analyzer')
const AssetSupplyAnalyzer = require('./aggregation/asset-supply-analyzer')
const {mapSacContract} = require('./aggregation/sac-contract-mapper')
const {UnexpectedTxMetaChangeError, TxMetaEffectParserError} = require('./errors')

class EffectsAnalyzer {
    constructor({
                    operation,
                    meta,
                    result,
                    network,
                    events,
                    diagnosticEvents,
                    mapSac,
                    processSystemEvents,
                    processFailedOpEffects,
                    processMetrics
                }) {
        //set execution context
        if (!operation.source)
            throw new TxMetaEffectParserError('Operation source is not explicitly defined')
        this.operation = operation
        this.isContractCall = this.operation.type === 'invokeHostFunction'
        this.result = result
        this.changes = parseLedgerEntryChanges(meta)
        this.source = this.operation.source
        this.events = events
        this.processFailedOpEffects = processFailedOpEffects
        this.processMetrics = processMetrics
        if (diagnosticEvents?.length) {
            this.diagnosticEvents = diagnosticEvents
            if (processSystemEvents) {
                this.processSystemEvents = true
            }
        }
        this.network = network
        if (mapSac) {
            this.sacMap = new Map()
        }
    }

    /**
     * @type {{}[]}
     * @internal
     * @readonly
     */
    effects = []
    /**
     * @type {Object}
     * @private
     * @readonly
     */
    operation = null
    /**
     * @type {String}
     * @readonly
     */
    network
    /**
     * @type {Map<string,string>}
     * @readonly
     */
    sacMap
    /**
     * @type {ParsedLedgerEntryMeta[]}
     * @private
     * @readonly
     */
    changes = null
    /**
     * @type {Object}
     * @private
     * @readonly
     */
    result = null
    /**
     * @type {String}
     * @private
     * @readonly
     */
    source = ''
    /**
     * @type {Boolean}
     * @private
     */
    isContractCall = false
    /**
     * @type {Boolean}
     * @readonly
     */
    processSystemEvents = false
    /**
     * @type {Boolean}
     * @readonly
     */
    processMetrics = true
    /**
     * @type {{}}
     * @private
     */
    metrics

    analyze() {
        //find appropriate parser method
        const parse = this[this.operation.type]
        if (parse) {
            parse.call(this)
        }
        //process Soroban events
        new EventsAnalyzer(this).analyze()
        //process state data changes in the end
        this.processStateChanges()
        //process ledger entry changes
        this.processChanges()
        //handle effects that are processed indirectly
        this.processSponsorshipEffects()
        //calculate minted/burned assets
        new AssetSupplyAnalyzer(this).analyze()
        //add Soroban op metrics if available
        if (this.metrics) {
            this.addEffect(this.metrics)
        }
        return this.effects
    }

    /**
     * @param {{}} effect
     * @param {Number} [atPosition]
     */
    addEffect(effect, atPosition) {
        if (!effect.source) {
            effect.source = this.source
        }
        if (atPosition >= 0) {
            this.effects.splice(atPosition < 0 ? 0 : atPosition, 0, effect)
        } else {
            this.effects.push(effect)
        }
    }

    debit(amount, asset, source, balance) {
        if (amount === '0')
            return
        const effect = {
            type: effectTypes.accountDebited,
            source,
            asset,
            amount: validateAmount(amount)
        }
        if (balance !== undefined) {
            effect.balance = balance
        }
        this.addEffect(effect)
    }

    credit(amount, asset, source, balance) {
        if (amount === '0')
            return
        const effect = {
            type: effectTypes.accountCredited,
            source,
            asset,
            amount: validateAmount(amount)
        }
        if (balance !== undefined) {
            effect.balance = balance
        }
        this.addEffect(effect)
    }

    mint(asset, amount, autoLookupPosition = false) {
        const position = autoLookupPosition ?
            this.effects.findIndex(e => e.asset === asset || e.assets?.find(a => a.asset === asset)) :
            undefined
        this.addEffect({
            type: effectTypes.assetMinted,
            asset,
            amount: validateAmount(amount)
        }, position)
    }

    burn(asset, amount, position = undefined) {
        this.addEffect({
            type: effectTypes.assetBurned,
            asset,
            amount: validateAmount(amount)
        }, position)
    }

    addMetric(contract, metric, value) {
        let {metrics} = this
        if (!metrics) {
            metrics = this.metrics = {
                type: effectTypes.contractMetrics,
                contract
            }
        }
        metrics[metric] = value
    }

    addFeeMetric(metaValue) {
        const {sorobanMeta} = metaValue
        if (!sorobanMeta)
            return
        const sorobanExt = sorobanMeta.ext?.value
        if (sorobanExt) {
            const fee = {
                nonrefundable: parseInt(parseLargeInt(sorobanExt.totalNonRefundableResourceFeeCharged)),
                refundable: parseInt(parseLargeInt(sorobanExt.totalRefundableResourceFeeCharged)),
                rent: parseInt(parseLargeInt(sorobanExt.rentFeeCharged))
            }
            this.addMetric(this.retrieveOpContractId(), 'fee', fee)
        }
    }

    setOptions() {
        const sourceAccount = normalizeAddress(this.source)
        const change = this.changes.find(ch => ch.type === 'account' && ch.before.address === sourceAccount)
        if (!change)
            return // failed tx or no changes
        const {before, after} = change
        if (before.homeDomain !== after.homeDomain) {
            this.addEffect({
                type: effectTypes.accountHomeDomainUpdated,
                domain: after.homeDomain
            })
        }
        if (before.thresholds !== after.thresholds) {
            this.addEffect({
                type: effectTypes.accountThresholdsUpdated,
                thresholds: after.thresholds.split(',').map(v => parseInt(v, 10))
            })
        }
        if (before.flags !== after.flags) {
            this.addEffect({
                type: effectTypes.accountFlagsUpdated,
                flags: after.flags,
                prevFlags: before.flags
            })
        }
        if (before.inflationDest !== after.inflationDest) {
            this.addEffect({
                type: effectTypes.accountInflationDestinationUpdated,
                inflationDestination: after.inflationDest
            })
        }
    }

    allowTrust() {
        this.setTrustLineFlags()
    }

    setTrustLineFlags() {
        if (!this.changes.length)
            return
        const trustAsset = xdrParseAsset(this.operation.asset || {
            code: this.operation.assetCode,
            issuer: normalizeAddress(this.source)
        })
        const change = this.changes.find(ch => ch.type === 'trustline' && ch.before.asset === trustAsset)
        if (!change)
            return
        if (change.action !== 'updated')
            throw new UnexpectedTxMetaChangeError(change)
        const {before, after} = change
        if (before.flags !== after.flags) {
            this.addEffect({
                type: effectTypes.trustlineAuthorizationUpdated,
                trustor: this.operation.trustor,
                asset: after.asset,
                flags: after.flags,
                prevFlags: before.flags
            })
            for (const change of this.changes) {
                if (change.type !== 'liquidityPool')
                    continue
                const {before, after} = change
                this.addEffect({
                    type: effectTypes.liquidityPoolWithdrew,
                    source: this.operation.trustor,
                    pool: before.pool,
                    assets: before.asset.map((asset, i) => ({
                        asset,
                        amount: (BigInt(before.amount[i]) - (after ? BigInt(after.amount[i]) : 0n)).toString()
                    })),
                    shares: (BigInt(before.shares) - (after ? BigInt(after.shares) : 0n)).toString()
                })
            }
        }
    }

    inflation() {
        /*const paymentEffects = (result.inflationPayouts || []).map(ip => ({
            type: effectTypes.accountCredited,
            source: ip.account,
            asset: 'XLM',
            amount: ip.amount
        }))*/
        this.addEffect({type: effectTypes.inflation})
    }

    bumpSequence() {
        if (!this.changes.length)
            return
        const change = this.changes.find(ch => ch.type === 'account')
        if (!change)
            return //failed tx or no changes
        const {before, after} = change
        if (before.sequence !== after.sequence) {
            this.addEffect({
                type: effectTypes.sequenceBumped,
                sequence: after.sequence
            })
        }
    }

    pathPaymentStrictReceive() {
        this.processDexOperationEffects()
    }

    pathPaymentStrictSend() {
        this.processDexOperationEffects()
    }

    manageSellOffer() {
        this.processDexOperationEffects()
    }

    manageBuyOffer() {
        this.processDexOperationEffects()
    }

    createPassiveSellOffer() {
        this.processDexOperationEffects()
    }

    liquidityPoolDeposit() {
        const pool = StrKey.encodeLiquidityPool(xdr.decodeBytes(this.operation.liquidityPoolId, 'hex'))
        const change = this.changes.find(ch => ch.type === 'liquidityPool' && ch.action === 'updated' && ch.after.pool === pool)
        if (!change) //tx failed
            return
        const {before, after} = change
        this.addEffect({
            type: effectTypes.liquidityPoolDeposited,
            pool,
            assets: after.asset.map((asset, i) => ({
                asset,
                amount: (after.amount[i] - before.amount[i]).toString()
            })),
            shares: (after.shares - before.shares).toString(),
            accounts: after.accounts
        })
    }

    liquidityPoolWithdraw() {
        const pool = StrKey.encodeLiquidityPool(xdr.decodeBytes(this.operation.liquidityPoolId, 'hex'))
        const change = this.changes.find(ch => ch.type === 'liquidityPool' && ch.action === 'updated' && ch.before.pool === pool)
        if (!change) //tx failed
            return
        const {before, after} = change
        this.addEffect({
            type: effectTypes.liquidityPoolWithdrew,
            pool,
            assets: before.asset.map((asset, i) => ({
                asset,
                amount: (before.amount[i] - after.amount[i]).toString()
            })),
            shares: (before.shares - after.shares).toString(),
            accounts: after.accounts
        })
    }

    invokeHostFunction() {
        const {func} = this.operation
        const value = func.value
        switch (func.type) {
            case 'hostFunctionTypeInvokeContract':
                if (!this.diagnosticEvents) {
                    //add top-level contract invocation effect only if diagnostic events are unavailable
                    const rawArgs = value.args
                    const effect = {
                        type: effectTypes.contractInvoked,
                        contract: xdrParseScAddress(value.contractAddress),
                        function: value.functionName.toString(),
                        args: rawArgs.map(xdrParseScVal),
                        rawArgs: nativeToScVal(rawArgs).toXdr('base64')
                    }
                    this.addEffect(effect)
                }
                break
            case 'hostFunctionTypeUploadContractWasm': {
                const codeHash = hash(value)
                this.addEffect({
                    type: effectTypes.contractCodeUploaded,
                    wasm: xdrParseBase64(value),
                    wasmHash: xdrParseHex(codeHash),
                    keyHash: generateContractCodeEntryHash(codeHash)
                })
                break
            }
            case 'hostFunctionTypeCreateContract':
            case 'hostFunctionTypeCreateContractV2': //handled in entry changes
                const executable = value.executable
                const executableType = executable.type
                //only SAC creation emitted here - the preimage carries issuer/salt/asset that the meta lacks
                if (executableType === 'contractExecutableStellarAsset') {
                    const preimage = value.contractIdPreimage
                    const preimageParams = preimage.value
                    const effect = {
                        type: effectTypes.contractCreated,
                        contract: contractIdFromPreimage(preimage, this.network)
                    }
                    switch (preimage.type) {
                        case 'contractIdPreimageFromAddress':
                            effect.kind = 'fromAddress'
                            effect.issuer = xdrParseAccountAddress(preimageParams.address.value)
                            effect.salt = xdrParseBase64(preimageParams.salt)
                            break
                        case 'contractIdPreimageFromAsset':
                            effect.kind = 'fromAsset'
                            effect.asset = xdrParseAsset(preimageParams)
                            break
                        default:
                            throw new TxMetaEffectParserError('Unknown preimage type: ' + preimage.type)
                    }
                    this.addEffect(effect)
                }
                break
            default:
                throw new TxMetaEffectParserError('Unknown host function call type: ' + func.type)
        }
    }

    bumpFootprintExpiration() {
        //const {ledgersToExpire} = this.operation
    }

    restoreFootprint() {
    }

    setAdmin(contractId, newAdmin) {
        const effect = {
            type: effectTypes.contractUpdated,
            contract: contractId,
            admin: newAdmin
        }
        this.addEffect(effect)
    }

    processDexOperationEffects() {
        if (!this.result)
            return
        //process trades first
        for (const claimedOffer of this.result.claimedOffers) {
            const trade = {
                type: effectTypes.trade,
                amount: claimedOffer.amount,
                asset: claimedOffer.asset
            }
            if (claimedOffer.poolId) {
                trade.pool = StrKey.encodeLiquidityPool(claimedOffer.poolId)
            } else {
                trade.offer = claimedOffer.offerId
                trade.seller = claimedOffer.account

            }
            this.addEffect(trade)
        }
    }

    processSponsorshipEffects() {
        for (const change of this.changes) {
            const {type, action, before, after} = change
            const effect = {}
            switch (action) {
                case 'created':
                case 'restored':
                    if (!after.sponsor)
                        continue
                    effect.sponsor = after.sponsor
                    break
                case 'updated':
                    if (before.sponsor === after.sponsor)
                        continue
                    effect.sponsor = after.sponsor
                    effect.prevSponsor = before.sponsor
                    break
                case 'removed':
                    if (!before.sponsor)
                        continue
                    effect.prevSponsor = before.sponsor
                    break
            }
            switch (type) {
                case 'account':
                    effect.account = before?.address || after?.address
                    break
                case 'trustline':
                    effect.account = before?.account || after?.account
                    effect.asset = before?.asset || after?.asset
                    break
                case 'offer':
                    effect.account = before?.account || after?.account
                    effect.offer = before?.id || after?.id
                    break
                case 'data':
                    effect.account = before?.account || after?.account
                    effect.name = before?.name || after?.name
                    break
                case 'claimableBalance':
                    effect.balance = before?.balanceId || after?.balanceId
                    //TODO: add claimable balance asset to the effect
                    break
                case 'liquidityPool':
                    //sponsored liquidity pool entry is never removed, so only created/updated effects are emitted
                    if (action !== 'created' && action !== 'updated')
                        continue
                    effect.pool = before?.pool || after?.pool
                    break
            }
            effect.type = encodeSponsorshipEffectName(action, type)
            this.addEffect(effect)
        }
    }

    processAccountChanges({action, before, after}) {
        switch (action) {
            case 'created':
                const accountCreated = {
                    type: effectTypes.accountCreated,
                    account: after.address
                }
                if (after.sponsor) {
                    accountCreated.sponsor = after.sponsor
                }
                this.addEffect(accountCreated)
                if (after.balance > 0) {
                    this.credit(after.balance, 'XLM', after.address, after.balance)
                }
                break
            case 'updated':
                if (before.balance !== after.balance) {
                    this.processBalanceChange(after.address, 'XLM', before.balance, after.balance)
                }
                //other operations do not yield signer sponsorship effects
                if (this.operation.type === 'setOptions' || this.operation.type === 'revokeSignerSponsorship') {
                    this.processSignerSponsorshipEffects({before, after})
                }
                break
            case 'removed':
                if (before.balance > 0) {
                    this.debit(before.balance, 'XLM', before.address, '0')
                }
                const accountRemoved = {
                    type: effectTypes.accountRemoved
                }
                if (before.sponsor) {
                    accountRemoved.sponsor = before.sponsor
                }
                this.addEffect(accountRemoved)
                break
        }

        for (const effect of analyzeSignerChanges(before, after)) {
            this.addEffect(effect)
        }
    }

    processTrustlineEffectsChanges({action, before, after}) {
        const snapshot = (after || before)
        const trustEffect = {
            type: '',
            source: snapshot.account,
            asset: snapshot.asset,
            kind: snapshot.asset.includes('-') ? 'asset' : 'poolShares',
            flags: snapshot.flags
        }
        if (snapshot.sponsor) {
            trustEffect.sponsor = snapshot.sponsor
        }
        switch (action) {
            case 'created':
                trustEffect.type = effectTypes.trustlineCreated
                trustEffect.limit = snapshot.limit
                break
            case 'updated':
                if (before.balance !== after.balance) {
                    this.processBalanceChange(after.account, after.asset, before.balance, after.balance)
                }
                if (before.limit === after.limit && before.flags === after.flags)
                    return
                trustEffect.type = effectTypes.trustlineUpdated
                trustEffect.limit = snapshot.limit
                trustEffect.prevFlags = before.flags
                break
            case 'removed':
                trustEffect.type = effectTypes.trustlineRemoved
                if (before.balance > 0) {
                    this.processBalanceChange(before.account, before.asset, before.balance, '0')
                }
                break
        }
        this.addEffect(trustEffect)
    }

    processBalanceChange(account, asset, beforeBalance, afterBalance) {
        if (this.isContractCall) { //map contract=>asset proactively
            mapSacContract(this, undefined, asset)
        }
        const balanceChange = BigInt(afterBalance) - BigInt(beforeBalance)
        if (balanceChange < 0n) {
            this.debit((-balanceChange).toString(), asset, account, afterBalance)
        } else {
            this.credit(balanceChange.toString(), asset, account, afterBalance)
        }
    }

    processSignerSponsorshipEffects({before, after}) {
        if (!before.signerSponsoringIDs?.length && !after.signerSponsoringIDs?.length)
            return
        const [beforeMap, afterMap] = [before, after].map(state => {
            const signersMap = {}
            if (state.signerSponsoringIDs?.length) {
                for (let i = 0; i < state.signers.length; i++) {
                    const sponsor = state.signerSponsoringIDs[i]
                    if (sponsor) { //add only sponsored signers to the map
                        signersMap[state.signers[i].key] = sponsor
                    }
                }
            }
            return signersMap
        })

        for (const signerKey of Object.keys(beforeMap)) {
            const newSponsor = afterMap[signerKey]
            if (!newSponsor) {
                this.addEffect({
                    type: effectTypes.signerSponsorshipRemoved,
                    account: before.address,
                    signer: signerKey,
                    prevSponsor: beforeMap[signerKey]
                })
                break
            }
            if (newSponsor !== beforeMap[signerKey]) {
                this.addEffect({
                    type: effectTypes.signerSponsorshipUpdated,
                    account: before.address,
                    signer: signerKey,
                    sponsor: newSponsor,
                    prevSponsor: beforeMap[signerKey]
                })
                break
            }
        }

        for (const signerKey of Object.keys(afterMap)) {
            const prevSponsor = beforeMap[signerKey]
            if (!prevSponsor) {
                this.addEffect({
                    type: effectTypes.signerSponsorshipCreated,
                    account: after.address,
                    signer: signerKey,
                    sponsor: afterMap[signerKey]
                })
                break
            }
        }
    }

    processOfferChanges({action, before, after}) {
        const snapshot = after || before
        const effect = {
            type: effectTypes.offerRemoved,
            owner: snapshot.account,
            offer: snapshot.id,
            asset: snapshot.asset,
            flags: snapshot.flags
        }
        if (snapshot.sponsor) {
            effect.sponsor = snapshot.sponsor
        }
        switch (action) {
            case 'created':
                effect.type = effectTypes.offerCreated
                effect.amount = after.amount
                effect.price = after.price
                break
            case 'updated':
                if (before.price === after.price && before.asset.join() === after.asset.join() && before.amount === after.amount)
                    return //no changes - skip
                effect.type = effectTypes.offerUpdated
                effect.amount = after.amount
                effect.price = after.price
                break
        }
        this.addEffect(effect)
    }

    processLiquidityPoolChanges({action, before, after}) {
        const snapshot = after || before
        const effect = {
            type: effectTypes.liquidityPoolRemoved,
            pool: snapshot.pool
        }
        if (snapshot.sponsor) {
            effect.sponsor = snapshot.sponsor
        }
        switch (action) {
            case 'created':
                Object.assign(effect, {
                    type: effectTypes.liquidityPoolCreated,
                    reserves: after.asset.map(asset => ({asset, amount: '0'})),
                    shares: '0',
                    accounts: 1
                })
                this.addEffect(effect, this.effects.findIndex(e => e.pool === effect.pool || e.asset === effect.pool))
                return
            case 'updated':
                Object.assign(effect, {
                    type: effectTypes.liquidityPoolUpdated,
                    reserves: after.asset.map((asset, i) => ({
                        asset,
                        amount: after.amount[i]
                    })),
                    shares: after.shares,
                    accounts: after.accounts
                })
                break
        }
        this.addEffect(effect)
    }

    processClaimableBalanceChanges({action, before, after}) {
        switch (action) {
            case 'created':
                this.addEffect({
                    type: effectTypes.claimableBalanceCreated,
                    sponsor: after.sponsor,
                    balance: after.balanceId,
                    asset: after.asset,
                    amount: after.amount,
                    claimants: after.claimants
                })
                break
            case 'removed':
                this.addEffect({
                    type: effectTypes.claimableBalanceRemoved,
                    sponsor: before.sponsor,
                    balance: before.balanceId,
                    asset: before.asset,
                    amount: before.amount,
                    claimants: before.claimants
                })
                break
            case 'updated':
                //nothing to process here
                break
        }
    }

    processDataEntryChanges({action, before, after}) {
        const effect = {type: ''}
        const {sponsor, name, value} = after || before
        effect.name = name
        effect.value = value && value.toString('base64')
        switch (action) {
            case 'created':
                effect.type = effectTypes.dataEntryCreated
                break
            case 'updated':
                if (before.value === after.value)
                    return //value has not changed
                effect.type = effectTypes.dataEntryUpdated
                break
            case 'removed':
                effect.type = effectTypes.dataEntryRemoved
                delete effect.value
                break
        }
        if (sponsor) {
            effect.sponsor = sponsor
        }
        this.addEffect(effect)
    }

    processContractChanges({action, before, after}) {
        const state = after || before
        const {kind, owner: contract, keyHash} = state
        let effect = {
            type: effectTypes.contractCreated,
            contract,
            kind,
            keyHash
        }
        switch (kind) {
            case 'fromAsset':
                effect.asset = state.asset
                break
            case 'wasm':
                effect.wasmHash = state.wasmHash
                break
            case 'external':
                effect.executableOwner = state.executableOwner
                effect.executableTag = state.executableTag
                break
            case 'fromAddress':
                break
            default:
                throw new TxMetaEffectParserError('Unexpected contract type: ' + kind)
        }
        switch (action) {
            case 'created':
                break
            case 'updated':
                if (sameExecutable(before, after)) { //skip if the executable hasn't changed
                    effect = undefined
                    break
                }
                effect.type = effectTypes.contractUpdated
                if (before.kind !== after.kind) {
                    effect.prevKind = before.kind
                }
                if (before.kind === 'wasm') {
                    effect.prevWasmHash = before.wasmHash
                } else if (before.kind === 'external') {
                    effect.prevExecutableOwner = before.executableOwner
                    effect.prevExecutableTag = before.executableTag
                }
                break
            case 'restored':
                effect.type = effectTypes.contractRestored
                break
            default:
                throw new UnexpectedTxMetaChangeError({type: 'contract', action})
        }
        if (effect) {
            if (effect.type === effectTypes.contractCreated) {
                const existing = this.effects.find(e => e.type === effectTypes.contractCreated && e.contract === effect.contract)
                if (!existing) { //the effect might be already emitted from the op call
                    this.addEffect(effect, this.effects.findIndex(e => e.contract === effect.contract || e.owner === effect.contract))
                } else {
                    existing.keyHash = effect.keyHash //assign keyHash, can't be calculated directly
                }
            } else {

                this.addEffect(effect)
            }
        }
        if (before?.storage?.length || after?.storage?.length) {
            this.processInstanceDataChanges(before, after, action === 'restored')
        }
    }

    processContractStateEntryChanges({action, before, after}) {
        const {owner, key, durability, keyHash} = after || before
        const effect = {
            type: '',
            owner,
            key,
            durability,
            keyHash
        }
        switch (action) {
            case 'created':
                effect.type = effectTypes.contractDataCreated
                effect.value = after.value
                break
            case 'updated':
                if (before.value === after.value)
                    return //value has not changed
                effect.type = effectTypes.contractDataUpdated
                effect.value = after.value
                effect.prevValue = before.value
                break
            case 'removed':
                effect.type = effectTypes.contractDataRemoved
                effect.prevValue = before.value
                break
            case 'restored':
                effect.type = effectTypes.contractDataRestored
                effect.value = after.value
                break
        }
        this.addEffect(effect)
        this.processExecutableRefChanges(action, before, after)
        const tokenBalance = xdrParseSacBalanceChange(effect.type, key, after?.value, before?.value)
        if (tokenBalance) {
            const balanceEffects = this.effects.filter(e => e.source === tokenBalance.address &&
                (e.type === effectTypes.accountCredited || e.type === effectTypes.accountDebited) &&
                (e.asset === effect.owner || e.asset === this.sacMap?.get(effect.owner)))
            if (!balanceEffects.length)
                return
            balanceEffects[balanceEffects.length - 1].balance = tokenBalance.balance //set latest transfer effect balance
        }
    }

    /**
     * Emit CAP-85 executable reference effects for the executable tag entry modifications
     * @param {String} action
     * @param {{}} [before]
     * @param {{}} [after]
     * @private
     */
    processExecutableRefChanges(action, before, after) {
        if (!after) //CAP-85 forbids the executable tag entry removal
            return
        if (!after.executableTag || !after.wasmHash) //not an executable reference entry, or the value is malformed
            return
        const effect = {
            type: action === 'created' ? effectTypes.contractExecutableRefCreated : effectTypes.contractExecutableRefUpdated,
            owner: after.owner,
            tag: after.executableTag,
            wasmHash: after.wasmHash,
            keyHash: after.keyHash
        }
        if (action === 'updated' && before.wasmHash) {
            effect.prevWasmHash = before.wasmHash
        }
        this.addEffect(effect)
    }

    processContractCodeChanges({type, action, before, after}) {
        const {hash, keyHash, wasm} = after || before
        switch (action) {
            case 'created':
                //ensure that the effect was not processed by the top-level createContract operation call
                if (!this.effects.some(e => e.type === effectTypes.contractCodeUploaded && e.keyHash === keyHash)) {
                    const effect = {
                        type: effectTypes.contractCodeUploaded,
                        wasm,
                        wasmHash: hash,
                        keyHash
                    }
                    this.addEffect(effect)
                }
                break //processed separately
            case 'updated':
                break //it doesn't change the state
            case 'removed':
                this.addEffect({
                    type: effectTypes.contractCodeRemoved,
                    wasmHash: hash,
                    keyHash
                })
                break
            case 'restored':
                this.addEffect({
                    type: effectTypes.contractCodeRestored,
                    wasmHash: hash,
                    keyHash
                })
                break
        }
    }

    processInstanceDataChanges(before, after, restored) {
        const storageBefore = before?.storage || []
        const storageAfter = [...(after?.storage || [])]
        if (!restored) {
            for (const {key, val} of storageBefore) {
                let newVal
                for (let i = 0; i < storageAfter.length; i++) {
                    const afterValue = storageAfter[i]
                    if (afterValue.key === key) {
                        newVal = afterValue.val //update new value
                        storageAfter.splice(i, 1) //remove from array to simplify iteration
                        break
                    }
                }
                if (newVal === undefined) { //removed
                    const effect = {
                        type: effectTypes.contractDataRemoved,
                        owner: after?.owner || before.owner,
                        key,
                        prevValue: val,
                        durability: 'instance'
                    }
                    this.addEffect(effect)
                    continue
                }
                if (val === newVal) //value has not changed
                    continue

                const effect = {
                    type: effectTypes.contractDataUpdated,
                    owner: after?.owner || before.owner,
                    key,
                    value: newVal,
                    prevValue: val,
                    durability: 'instance'
                }
                this.addEffect(effect)
            }
        }
        //iterate all storage items left
        for (const {key, val} of storageAfter) {
            const effect = {
                type: restored ? effectTypes.contractDataRestored : effectTypes.contractDataCreated,
                owner: after?.owner || before.owner,
                key,
                value: val,
                durability: 'instance'
            }
            this.addEffect(effect)
        }
    }

    processTtlChanges({before, after}) {
        const {keyHash, ttl} = after || before
        const effect = {
            type: effectTypes.setTtl,
            keyHash,
            ttl
        }
        for (const emitted of this.effects) {
            if (emitted.keyHash === keyHash && emitted.type !== effectTypes.setTtl) {
                if (emitted.type.startsWith('contractCode')) {
                    effect.kind = 'contractCode'
                } else if (emitted.type.startsWith('contractData') || emitted.type.startsWith('contractExecutableRef')) {
                    effect.kind = 'contractData'
                    effect.owner = emitted.owner
                } else if (emitted.type.startsWith('contract')) {
                    effect.kind = 'contractData'
                    effect.owner = emitted.contract
                } else
                    throw new UnexpectedTxMetaChangeError({type: 'ttl', action: emitted.type})
                emitted.ttl = ttl
            }
        }
        this.addEffect(effect)
    }

    processChanges() {
        for (const change of this.changes)
            switch (change.type) {
                case 'account':
                    this.processAccountChanges(change)
                    break
                case 'trustline':
                    this.processTrustlineEffectsChanges(change)
                    break
                case 'claimableBalance':
                    this.processClaimableBalanceChanges(change)
                    break
                case 'offer':
                    this.processOfferChanges(change)
                    break
                case 'liquidityPool':
                    this.processLiquidityPoolChanges(change)
                    break
                case 'data':
                    this.processDataEntryChanges(change)
                    break
                case 'contractData':
                    if (change.before?.kind || change.after?.kind) {
                        this.processContractChanges(change)
                    }
                    break
                case 'contractCode':
                    this.processContractCodeChanges(change)
                    break
                case 'ttl':
                    this.processTtlChanges(change)
                    break
                default:
                    throw new UnexpectedTxMetaChangeError(change)
            }
        //ensure that the wasm upload effect always precedes contract creation and executable reference effects
        for (let i = 0; i < this.effects.length; i++) {
            const effect = this.effects[i]
            if (effect.type === effectTypes.contractCodeUploaded) {
                //find the first reference in the already emitted effects
                const createdFromCodeIdx = this.effects.findIndex(e => referencesUploadedCode(e, effect.wasmHash))
                //reorder effects if needed
                if (createdFromCodeIdx >= 0) {
                    this.effects.splice(i, 1)
                    this.effects.splice(createdFromCodeIdx, 0, effect)
                    i--
                }
            }
        }
    }

    processStateChanges() {
        for (const change of this.changes)
            if (change.type === 'contractData') {
                this.processContractStateEntryChanges(change)
            }
    }

    /**
     * @return {String|null}
     * @private
     */
    retrieveOpContractId() {
        const funcValue = this.operation.func?.value
        if (funcValue) {
            const {contractAddress, contractIdPreimage} = funcValue
            if (contractAddress)
                return xdrParseScAddress(contractAddress)
            if (contractIdPreimage)
                return contractIdFromPreimage(contractIdPreimage, this.network)
        }
        return null
    }

    /**
     *
     * @param assetOrContract
     * @return {*}
     */
    resolveAsset(assetOrContract) {
        if (!assetOrContract.startsWith('C') || !this.sacMap)
            return assetOrContract
        //try to resolve using SAC map
        return this.sacMap.get(assetOrContract) || assetOrContract
    }
}

/**
 * Generates fee charged effect
 * @param {{}} tx - Transaction
 * @param {String} source - Source account
 * @param {String} chargedAmount - Charged amount
 * @param {Boolean} [feeBump] - Is fee bump transaction
 * @returns {{}} - Fee charged effect
 */
function processFeeChargedEffect(tx, source, chargedAmount, feeBump = false) {
    if (tx instanceof xdr.TransactionEnvelope) { //raw XDR
        const txXdr = tx.value.tx
        tx = {
            source: xdrParseAccountAddress(txXdr.feeSource ?? txXdr.sourceAccount),
            fee: txXdr.fee.toString()
        }
    }
    const res = {
        type: effectTypes.feeCharged,
        source,
        asset: 'XLM',
        bid: tx.fee,
        charged: chargedAmount
    }
    if (feeBump) {
        res.bump = true
    }
    return res
}

/**
 * Check whether the effect points to an uploaded contract code by its Wasm hash
 * @param {{}} effect
 * @param {string} refWasmHash
 * @return {Boolean}
 */
function referencesUploadedCode(effect, refWasmHash) {
    switch (effect.type) {
        case effectTypes.contractCreated:
        case effectTypes.contractExecutableRefCreated:
        case effectTypes.contractExecutableRefUpdated:
            return refWasmHash === effect.wasmHash
        default:
            return false
    }
}

/**
 * Check whether two contract instance snapshots refer to the same executable
 * @param {{}} before - Instance state before changes
 * @param {{}} after - Instance state after changes
 * @return {boolean}
 */
function sameExecutable(before, after) {
    //compare the raw XDR executable type - `kind` for SAC contracts is derived from the storage presence heuristic
    if (before?.executableType !== after?.executableType)
        return false
    switch (after.executableType) {
        case 'contractExecutableWasm':
            return before.wasmHash === after.wasmHash
        case 'contractExecutableExternalRef':
            return before.executableOwner === after.executableOwner && before.executableTag === after.executableTag
        default:
            return true //SAC executables never change
    }
}

/**
 * @param {String} action
 * @param {String} type
 * @return {String}
 */
function encodeSponsorshipEffectName(action, type) {
    let actionKey
    switch (action) {
        case 'created':
            actionKey = 'Created'
            break
        case 'updated':
            actionKey = 'Updated'
            break
        case 'removed':
            actionKey = 'Removed'
            break
        case 'restored':
            actionKey = 'Restored'
            break
        default:
            throw new UnexpectedTxMetaChangeError({action, type})
    }
    return effectTypes[`${type}Sponsorship${actionKey}`]
}

module.exports = {EffectsAnalyzer, processFeeChargedEffect}
