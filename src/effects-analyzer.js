const {StrKey, hash, xdr, nativeToScVal} = require('@stellar/stellar-base')
const effectTypes = require('./effect-types')
const {validateAmount, normalizeAddress, parseLargeInt} = require('./parser/normalization')
const {parseLedgerEntryChanges} = require('./parser/ledger-entry-changes-parser')
const {
    xdrParseAsset,
    xdrParseAccountAddress,
    xdrParseScVal,
    xdrParseSacBalanceChange
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
        if (atPosition !== undefined) {
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
        const {sorobanMeta} = metaValue._attributes
        if (!sorobanMeta)
            return
        const sorobanExt = sorobanMeta._attributes.ext._value
        if (sorobanExt) {
            const attrs = sorobanExt._attributes
            const fee = {
                nonrefundable: parseInt(parseLargeInt(attrs.totalNonRefundableResourceFeeCharged)),
                refundable: parseInt(parseLargeInt(attrs.totalRefundableResourceFeeCharged)),
                rent: parseInt(parseLargeInt(attrs.rentFeeCharged))
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
        const pool = StrKey.encodeLiquidityPool(Buffer.from(this.operation.liquidityPoolId, 'hex'))
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
        const pool = StrKey.encodeLiquidityPool(Buffer.from(this.operation.liquidityPoolId, 'hex'))
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
        const value = func.value()
        switch (func.arm()) {
            case 'invokeContract':
                if (!this.diagnosticEvents) {
                    //add top-level contract invocation effect only if diagnostic events are unavailable
                    const rawArgs = value.args()
                    const effect = {
                        type: effectTypes.contractInvoked,
                        contract: xdrParseScVal(value.contractAddress()),
                        function: value.functionName().toString(),
                        args: rawArgs.map(xdrParseScVal),
                        rawArgs: nativeToScVal(rawArgs).toXDR('base64')
                    }
                    this.addEffect(effect)
                }
                break
            case 'wasm': {
                const codeHash = hash(value)
                this.addEffect({
                    type: effectTypes.contractCodeUploaded,
                    wasm: value.toString('base64'),
                    wasmHash: codeHash.toString('hex'),
                    keyHash: generateContractCodeEntryHash(codeHash)
                })
                break
            }
            case 'createContract':
            case 'createContractV2':
                const preimage = value.contractIdPreimage()
                const executable = value.executable()
                const executableType = executable.switch().name

                const effect = {
                    type: effectTypes.contractCreated,
                    contract: contractIdFromPreimage(preimage, this.network)
                }
                switch (executableType) {
                    case 'contractExecutableWasm':
                        effect.kind = 'wasm'
                        effect.wasmHash = executable.wasmHash().toString('hex')
                        break
                    case 'contractExecutableStellarAsset':
                        const preimageParams = preimage.value()
                        switch (preimage.switch().name) {
                            case 'contractIdPreimageFromAddress':
                                effect.kind = 'fromAddress'
                                effect.issuer = xdrParseAccountAddress(preimageParams.address().value())
                                effect.salt = preimageParams.salt().toString('base64')
                                break
                            case 'contractIdPreimageFromAsset':
                                effect.kind = 'fromAsset'
                                effect.asset = xdrParseAsset(preimageParams)
                                break
                            default:
                                throw new TxMetaEffectParserError('Unknown preimage type: ' + preimage.switch().name)
                        }
                        break
                    default:
                        throw new TxMetaEffectParserError('Unknown contract type: ' + executableType)
                }
                if (func.arm() === 'createContractV2') {
                    const args = value.constructorArgs() //array
                    if (args.length > 0) {
                        effect.constructorArgs = args.map(arg => arg.toXDR('base64'))
                    }
                }
                this.addEffect(effect, 0)
                break
            default:
                throw new TxMetaEffectParserError('Unknown host function call type: ' + func.arm())
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
                case 'liquidityPool': //ignore??
                    continue
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
        const {kind, owner: contract, keyHash} = after
        let effect = {
            type: effectTypes.contractCreated,
            contract,
            kind,
            keyHash
        }
        switch (kind) {
            case 'fromAsset':
                effect.asset = after.asset
                break
            case 'wasm':
                effect.wasmHash = after.wasmHash
                break
            default:
                throw new TxMetaEffectParserError('Unexpected contract type: ' + kind)
        }
        switch (action) {
            case 'created':
                if (this.effects.some(e => e.type === effectTypes.contractCreated && e.contract === contract)) {
                    effect = undefined //skip contract creation effects processed by top-level createContract operation call
                }
                break
            case 'updated':
                effect.type = effectTypes.contractUpdated
                effect.prevWasmHash = before.wasmHash
                if (before.wasmHash === after.wasmHash) {//skip if hash unchanged
                    effect = undefined
                }
                break
            case 'restored':
                effect.type = effectTypes.contractRestored
                break
            default:
                throw new UnexpectedTxMetaChangeError({type: 'contract', action})
        }
        if (effect) {
            this.addEffect(effect, effect.type === effectTypes.contractCreated ? 0 : undefined)
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
        const tokenBalance = xdrParseSacBalanceChange(effect.type, key, after?.value, before?.value)
        if (tokenBalance) {
            const balanceEffects = this.effects.filter(e => e.source === tokenBalance.address &&
                (e.type === effectTypes.accountCredited || e.type === effectTypes.accountDebited) &&
                (e.asset === effect.owner || e.asset === this.sacMap?.get(effect.owner)))
            if (balanceEffects.length !== 1)
                return //we can set balance only when we found 1-1 mapping, if there are several balance changes, we can't establish balance relation
            balanceEffects[0].balance = tokenBalance.balance //set transfer effect balance
        }
    }

    processContractCodeChanges({type, action, before, after}) {
        const {hash, keyHash} = after || before
        switch (action) {
            case 'created':
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

    processTtlChanges({action, before, after}) {
        /*if (action === 'removed')
            throw new UnexpectedTxMetaChangeError({type: 'ttl', action})*/
        const {keyHash, ttl} = after || before
        const stateEffect = this.effects.find(e => e.keyHash === keyHash && e.type !== effectTypes.setTtl)
        const effect = {
            type: effectTypes.setTtl,
            keyHash,
            ttl
        }
        if (stateEffect) {
            if (stateEffect.type.startsWith('contractCode')) {
                effect.kind = 'contractCode'
            } else if (stateEffect.type.startsWith('contractData')) {
                effect.kind = 'contractData'
                effect.owner = stateEffect.owner
            } else if (stateEffect.type.startsWith('contract')) {
                effect.kind = 'contractData'
                effect.owner = stateEffect.contract
            } else
                throw new UnexpectedTxMetaChangeError({type: 'ttl', action: stateEffect.type})
            stateEffect.ttl = ttl
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
        const funcValue = this.operation.func._value._attributes
        if (funcValue) {
            if (funcValue.contractAddress)
                return StrKey.encodeContract(funcValue.contractAddress._value)
            const preimage = funcValue.contractIdPreimage
            if (preimage)
                return contractIdFromPreimage(preimage, this.network)
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
    if (tx._switch) { //raw XDR
        const txXdr = tx.value().tx()
        tx = {
            source: xdrParseAccountAddress((txXdr.feeSource ? txXdr.feeSource : txXdr.sourceAccount).call(txXdr)),
            fee: txXdr.fee().toString()
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
