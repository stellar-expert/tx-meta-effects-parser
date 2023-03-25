const {StrKey} = require('stellar-sdk')
const effectTypes = require('./effect-types')
const {parseLedgerEntryChanges} = require('./ledger-entry-changes-parser')
const {xdrParseAsset, xdrParseAccountAddress} = require('./tx-xdr-parser-utils')
const {normalizeAddress, adjustPrecision, trimZeros, encodeSponsorshipEffectName, diff} = require('./analyzer-primitives')
const AssetSupplyProcessor = require('./asset-supply-processor')
const {UnexpectedTxMetaChangeError, TxMetaEffectParserError} = require('./errors')

class EffectsAnalyzer {
    /**
     * @type {{}[]}
     * @private
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

    analyze(operation, meta, result) {
        //set execution context
        if (!operation.source)
            throw new TxMetaEffectParserError('Operation source is not defined')
        this.operation = operation
        this.result = result
        this.changes = parseLedgerEntryChanges(meta)
        this.source = normalizeAddress(this.operation.source)
        //find appropriate parsing method
        const parse = this[operation.type]
        if (parse) {
            parse.call(this)
        }
        this.processChanges()
        //handle effects that are processed indirectly
        this.processSponsorshipEffects()
        //calculate minted/burned assets
        this.processAssetSupplyEffects()
        const res = this.effects
        //reset context
        this.effects = []
        this.operation = null
        this.meta = null
        this.result = null
        this.source = ''
        return res
    }

    /**
     * @param {{}} effect
     * @param {Number} atPosition?
     */
    addEffect(effect, atPosition = undefined) {
        if (!effect.source) {
            effect.source = this.source
        }
        if (atPosition !== undefined) {
            this.effects.splice(atPosition < 0 ? 0 : atPosition, 0, effect)
        } else {
            this.effects.push(effect)
        }
    }

    debit(amount, asset, source = null) {
        this.addEffect({
            type: effectTypes.accountDebited,
            source,
            asset,
            amount
        })
    }

    credit(amount, asset, source = null) {
        this.addEffect({
            type: effectTypes.accountCredited,
            source,
            asset,
            amount
        })
    }

    setOptions() {
        const {operation} = this
        const {before, after} = this.changes.find(ch => ch.type === 'account' && ch.before.address === this.source)
        if (before.homeDomain !== after.homeDomain) {
            this.addEffect({
                type: effectTypes.accountHomeDomainUpdated,
                domain: after.homeDomain
            })
        }
        if (JSON.stringify(before.thresholds) !== JSON.stringify(after.thresholds)) {
            this.addEffect({
                type: effectTypes.accountThresholdsUpdated,
                thresholds: after.thresholds
            })
        }
        if (before.flags !== after.flags) {
            this.addEffect({
                type: effectTypes.accountFlagsUpdated,
                flags: after.flags
            })
        }
        if (before.inflationDest !== after.inflationDest) {
            this.addEffect({
                type: effectTypes.accountInflationDestinationUpdated,
                inflationDestination: after.inflationDest
            })
        }
        if (operation.masterWeight !== undefined && before.masterWeight !== after.masterWeight) {
            if (operation.masterWeight > 0) {
                this.addEffect({
                    type: effectTypes.accountSignerUpdated,
                    signer: after.address,
                    weight: after.masterWeight,
                    masterWeight: after.masterWeight,
                    signers: after.signers
                })
            } else {
                this.addEffect({
                    type: effectTypes.accountSignerRemoved,
                    signer: after.address,
                    weight: after.masterWeight,
                    masterWeight: after.masterWeight,
                    signers: after.signers
                })
            }
        }
        if (operation.signer !== undefined && JSON.stringify(before.signers) !== JSON.stringify(after.signers)) {
            const {signer} = operation
            const weight = signer.weight || 0
            let key
            if (signer.sha256Hash) {
                key = StrKey.encodeSha256Hash(signer.sha256Hash)
            } else if (signer.preAuthTx) {
                key = StrKey.encodePreAuthTx(signer.preAuthTx)
            } else {
                key = operation.signer.ed25519PublicKey || operation.signer.ed25519SignedPayload
            }
            if (weight === 0) {
                this.addEffect({
                    type: effectTypes.accountSignerRemoved,
                    signer: key,
                    weight,
                    masterWeight: after.masterWeight,
                    signers: after.signers
                })
            } else if (before.signers.length < after.signers.length) {
                this.addEffect({
                    type: effectTypes.accountSignerCreated,
                    signer: key,
                    weight,
                    masterWeight: after.masterWeight,
                    signers: after.signers
                })
            } else {
                this.addEffect({
                    type: effectTypes.accountSignerUpdated,
                    signer: key,
                    weight,
                    masterWeight: after.masterWeight,
                    signers: after.signers
                })
            }
        }
    }

    allowTrust() {
        this.setTrustLineFlags()
    }

    setTrustLineFlags() {
        if (!this.changes.length)
            return
        const trustAsset = xdrParseAsset(this.operation.asset || {code: this.operation.assetCode, issuer: this.source})
        const trustlineChange = this.changes.find(ch => ch.type === 'trustline' && ch.before.asset === trustAsset)
        if (trustlineChange) {
            if (trustlineChange.action !== 'updated')
                throw new UnexpectedTxMetaChangeError(trustlineChange)
            const {before, after} = trustlineChange
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
                            amount: adjustPrecision(diff(before.amount[i], after ? after.amount[i] : '0'))
                        })),
                        shares: trimZeros(diff(before.shares, after ? after.shares : '0'))
                    })
                }
            }
        }
    }

    inflation() {
        /*const paymentEffects = (result.inflationPayouts || []).map(ip => ({
            type: effectTypes.accountCredited,
            source: ip.account,
            asset: 'XLM',
            amount: adjustPrecision(ip.amount)
        }))*/
        this.addEffect({type: effectTypes.inflation})
    }

    bumpSequence() {
        if (!this.changes.length)
            return
        const {before, after} = this.changes.find(ch => ch.type === 'account')
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
        const {liquidityPoolId} = this.operation
        const {
            before,
            after
        } = this.changes.find(ch => ch.type === 'liquidityPool' && ch.action === 'updated' && ch.after.pool === liquidityPoolId)
        this.addEffect({
            type: effectTypes.liquidityPoolDeposited,
            pool: this.operation.liquidityPoolId,
            assets: after.asset.map((asset, i) => ({
                asset,
                amount: adjustPrecision(diff(after.amount[i], before.amount[i]))
            })),
            shares: trimZeros(diff(after.shares, before.shares))
        })
    }

    liquidityPoolWithdraw() {
        const pool = this.operation.liquidityPoolId
        const {before, after} = this.changes.find(ch => ch.type === 'liquidityPool' && ch.action === 'updated' && ch.before.pool === pool)
        this.addEffect({
            type: effectTypes.liquidityPoolWithdrew,
            pool,
            assets: before.asset.map((asset, i) => ({
                asset,
                amount: adjustPrecision(diff(before.amount[i], after.amount[i]))
            })),
            shares: trimZeros(diff(before.shares, after.shares))
        })
    }

    processDexOperationEffects() {
        //process trades first
        for (const claimedOffer of this.result.claimedOffers) {
            const amount = claimedOffer.amount.map(adjustPrecision)
            const trade = {
                type: effectTypes.trade,
                amount,
                asset: claimedOffer.asset
            }
            if (claimedOffer.poolId) {
                trade.pool = claimedOffer.poolId.toString('hex')
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
                    this.credit(adjustPrecision(after.balance), 'XLM', after.address)
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
                    this.debit(adjustPrecision(before.balance), 'XLM', before.address)
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
                trustEffect.limit = adjustPrecision(snapshot.limit)
                break
            case 'updated':
                if (before.balance !== after.balance) {
                    this.processBalanceChange(after.account, after.asset, before.balance, after.balance)
                }
                if (before.limit === after.limit && before.flags === after.flags)
                    return
                trustEffect.type = effectTypes.trustlineUpdated
                trustEffect.limit = adjustPrecision(snapshot.limit)
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
        const balanceChange = adjustPrecision(diff(afterBalance, beforeBalance))
        if (balanceChange < 0) {
            this.debit(balanceChange.replace('-', ''), asset, account)
        } else {
            this.credit(balanceChange, asset, account)
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
                effect.amount = adjustPrecision(after.amount)
                effect.price = after.price
                break
            case 'updated':
                if (before.price === after.price && before.asset.join() === after.asset.join() && before.amount === after.amount)
                    return //no changes - skip
                effect.type = effectTypes.offerUpdated
                effect.amount = adjustPrecision(after.amount)
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
                        amount: adjustPrecision(after.amount[i])
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
                    amount: adjustPrecision(after.amount),
                    claimants: after.claimants
                })
                break
            case 'removed':
                this.addEffect({
                    type: effectTypes.claimableBalanceRemoved,
                    sponsor: before.sponsor,
                    balance: before.balanceId,
                    asset: before.asset,
                    amount: adjustPrecision(before.amount),
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
                default:
                    throw new UnexpectedTxMetaChangeError(change)
            }
    }

    processAssetSupplyEffects() {
        const supplyProcessor = new AssetSupplyProcessor(this.effects)
        for (const effect of supplyProcessor.resolve()) {
            this.addEffect(effect, effect.type === effectTypes.assetMinted ?
                this.effects.findIndex(e => e.asset === effect.asset || e.assets?.find(a => a.asset === effect.asset)) :
                undefined)
        }
    }
}

const analyzer = new EffectsAnalyzer()

/**
 * Processes operation effects
 * @param {{operation: {}, meta: LedgerEntryChange[], result: {}}} operationData - operation data
 * @returns {{}[]} - operation effects
 */
function analyzeOperationEffects({operation, meta, result}) {
    return analyzer.analyze(operation, meta, result)
}

/**
 * Generates fee charged effect
 * @param {{}} tx - Transaction
 * @param {String} chargedAmount - Charged amount
 * @param {Boolean} feeBump? - Is fee bump transaction
 * @returns {{}} - Fee charged effect
 */
function processFeeChargedEffect(tx, chargedAmount, feeBump = false) {
    if (tx._switch) { //raw XDR
        const txXdr = tx.value().tx()
        tx = {
            source: xdrParseAccountAddress((txXdr.feeSource ? txXdr.feeSource : txXdr.sourceAccount).call(txXdr)),
            fee: txXdr.fee()
        }
    }
    const res = {
        type: effectTypes.feeCharged,
        source: normalizeAddress(tx.feeSource || tx.source),
        asset: 'XLM',
        bid: adjustPrecision(tx.fee),
        charged: adjustPrecision(chargedAmount)
    }
    if (feeBump) {
        res.bump = true
    }
    return res
}

module.exports = {analyzeOperationEffects, processFeeChargedEffect}
