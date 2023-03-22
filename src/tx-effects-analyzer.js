const {StrKey} = require('stellar-sdk')
const Bignumber = require('bignumber.js')
const effectTypes = require('./effect-types')
const {parseLedgerEntryChanges} = require('./ledger-entry-changes-parser')
const {xdrParseAsset, xdrParseAccountAddress} = require('./tx-xdr-parser-utils')
const {calculateTradesSourceAmount, calculateTrustlineBalanceChange} = require('./effect-amount-calculation')
const {normalizeAddress, adjustPrecision, trimZeros, encodeSponsorshipEffectName, isIssuer} = require('./analyzer-primitives')
const {UnexpectedMetaChangeError} = require('./errors')

/**
 * Processes operation effects and returns them
 * @param {{operation: {}, meta: LedgerEntryChange[], result: {}}} operationData - operation data
 * @returns {any[]} - operation effects
 */
function analyzeOperationEffects({operation, meta, result}) {
    //TODO: check that operation always has correct source account
    if (!operation.source)
        throw new Error('Operation source is not defined')
    const handler = effectProcessorMap[operation.type]
    const changes = parseLedgerEntryChanges(meta)
    operation.effects = handler(operation, changes, result)
    processSponsorshipEffects(operation, changes)
    processSignerSponsorshipEffects(operation, changes)
    return operation.effects
}

const effectProcessorMap = {
    createAccount: processCreateAccountEffects,
    accountMerge: processMergeAccountEffects,
    payment: processPaymentEffects,
    pathPaymentStrictReceive: processPathPaymentStrictReceiveEffects,
    pathPaymentStrictSend: processPathPaymentStrictSendEffects,
    manageSellOffer: processDexOperationEffects,
    createPassiveSellOffer: processDexOperationEffects,
    manageBuyOffer: processDexOperationEffects,
    setOptions: processSetOptionsEffects,
    changeTrust: processChangeTrustEffects,
    allowTrust: processAllowTrustEffects,
    inflation: processInflationEffects,
    manageData: processManageDataEffects,
    bumpSequence: processBumpSequenceEffects,
    createClaimableBalance: processCreateClaimableBalanceEffects,
    claimClaimableBalance: processClaimClaimableBalanceEffects,
    setTrustLineFlags: processAllowTrustEffects,
    liquidityPoolDeposit: processLiquidityPoolDepositEffects,
    liquidityPoolWithdraw: processLiquidityPoolWithdrawEffects,
    clawback: processClawbackEffects,
    clawbackClaimableBalance: processClawbackClaimableBalanceEffects,
    beginSponsoringFutureReserves: noEffects,
    endSponsoringFutureReserves: noEffects,
    revokeSponsorship: noEffects,
    revokeAccountSponsorship: noEffects,
    revokeTrustlineSponsorship: noEffects,
    revokeOfferSponsorship: noEffects,
    revokeDataSponsorship: noEffects,
    revokeClaimableBalanceSponsorship: noEffects,
    revokeLiquidityPoolSponsorship: noEffects,
    revokeSignerSponsorship: noEffects
}

/**
 * Generates fee charged effect
 * @param {{}} tx - transaction
 * @param {String} chargedAmount - charged amount
 * @param {Boolean} feeBump - is fee bump
 * @returns {{}} - fee charged effect
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

function processCreateAccountEffects(operation, changes) {
    const source = normalizeAddress(operation.source)
    const accountCreated = {
        type: effectTypes.accountCreated,
        source,
        account: operation.destination
    }
    const {after} = changes.find(c => c.type === 'account' && c.action === 'created')
    if (after.sponsor) {
        accountCreated.sponsor = after.sponsor
    }
    if (parseFloat(operation.startingBalance) === 0)
        return [accountCreated]
    return [
        accountCreated,
        {
            type: effectTypes.accountDebited,
            source,
            asset: 'XLM',
            amount: trimZeros(operation.startingBalance)
        },
        {
            type: effectTypes.accountCredited,
            source: operation.destination,
            asset: 'XLM',
            amount: trimZeros(operation.startingBalance)
        }
    ]
}

function processMergeAccountEffects(operation, changes, result) {
    const source = normalizeAddress(operation.source)
    const removedMeta = changes.find(c => c.type === 'account' && c.action === 'removed')
    const effects = []
    if (removedMeta) {
        const {before} = removedMeta
        if (before.address !== source)
            throw new UnexpectedMetaChangeError(removedMeta)
        if (result.actualMergedAmount > 0) {
            effects.push({
                type: effectTypes.accountDebited,
                source,
                asset: 'XLM',
                amount: adjustPrecision(before.balance)
            })
            effects.push({
                type: effectTypes.accountCredited,
                source: normalizeAddress(operation.destination),
                asset: 'XLM',
                amount: adjustPrecision(result.actualMergedAmount)
            })
        }
        const accountRemoved = {
            type: effectTypes.accountRemoved,
            source
        }
        if (removedMeta.before.sponsor) {
            accountRemoved.sponsor = removedMeta.before.sponsor
        }
        effects.push(accountRemoved)
    } else { //merge-merge tx bug
        if (result.actualMergedAmount > 0) {
            effects.push({
                type: effectTypes.accountCredited,
                source: normalizeAddress(operation.destination),
                asset: 'XLM',
                amount: adjustPrecision(result.actualMergedAmount)
            })
        }
    }
    return effects
}

function processSetOptionsEffects(operation, changes) {
    const source = normalizeAddress(operation.source)
    const effects = []
    const {before, after} = changes.find(ch => ch.type === 'account' && ch.before.address === source)
    if (before.homeDomain !== after.homeDomain) {
        effects.push({
            type: effectTypes.accountHomeDomainUpdated,
            source,
            domain: after.homeDomain
        })
    }
    if (JSON.stringify(before.thresholds) !== JSON.stringify(after.thresholds)) {
        effects.push({
            type: effectTypes.accountThresholdsUpdated,
            source,
            thresholds: after.thresholds
        })
    }
    if (before.flags !== after.flags) {
        effects.push({
            type: effectTypes.accountFlagsUpdated,
            source,
            flags: after.flags
        })
    }
    if (before.inflationDest !== after.inflationDest) {
        effects.push({
            type: effectTypes.accountInflationDestinationUpdated,
            source,
            inflationDestination: after.inflationDest
        })
    }
    if (operation.masterWeight !== undefined && before.masterWeight !== after.masterWeight) {
        if (operation.masterWeight > 0) {
            effects.push({
                type: effectTypes.accountSignerUpdated,
                source,
                signer: after.address,
                weight: after.masterWeight,
                masterWeight: after.masterWeight,
                signers: after.signers
            })
        } else {
            effects.push({
                type: effectTypes.accountSignerRemoved,
                source,
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
            effects.push({
                type: effectTypes.accountSignerRemoved,
                source,
                signer: key,
                weight,
                masterWeight: after.masterWeight,
                signers: after.signers
            })
        } else if (before.signers.length < after.signers.length) {
            effects.push({
                type: effectTypes.accountSignerCreated,
                source,
                signer: key,
                weight,
                masterWeight: after.masterWeight,
                signers: after.signers
            })
        } else {
            effects.push({
                type: effectTypes.accountSignerUpdated,
                source,
                signer: key,
                weight,
                masterWeight: after.masterWeight,
                signers: after.signers
            })
        }
    }
    return effects
}

function processChangeTrustEffects(operation, changes) {
    return [
        ...processLiquidityPoolChanges(operation, changes),
        ...processTrustlineEffectsChanges(operation, changes)
    ]
}

function processAllowTrustEffects(operation, changes) {
    if (!changes.length)
        return []
    const source = normalizeAddress(operation.source)
    const trustAsset = xdrParseAsset(operation.asset || {code: operation.assetCode, issuer: source})
    const trustlineChange = changes.find(ch => ch.type === 'trustline' && ch.before.asset === trustAsset)
    const effects = []
    if (trustlineChange) {
        if (trustlineChange.action !== 'updated')
            throw new UnexpectedMetaChangeError(trustlineChange)
        const {before, after} = trustlineChange
        if (before.flags !== after.flags) {
            effects.push({
                type: effectTypes.trustlineAuthorizationUpdated,
                source,
                trustor: operation.trustor,
                asset: after.asset,
                flags: after.flags,
                prevFlags: before.flags
            })
        }
    }

    return [
        ...effects,
        ...processTrustlineEffectsChanges(operation, changes),
        ...processLiquidityPoolChanges(operation, changes),
        ...processOfferChanges(operation, changes),
        ...processClaimableBalanceChanges(operation, changes)
    ]
}

function processPaymentEffects(operation, changes) {
    const source = normalizeAddress(operation.source)
    const destination = normalizeAddress(operation.destination)
    const amount = trimZeros(operation.amount)
    if (source === destination)
        return [] //self-transfer
    const asset = xdrParseAsset(operation.asset)
    return [
        ...processPaymentBalanceChanges(source, asset, changes, null, amount),
        ...processPaymentBalanceChanges(destination, asset, changes, null, '-' + amount)
    ]
}

function processPathPaymentStrictReceiveEffects(operation, changes, result) {
    if (!changes.length)
        return [] //self-transfer without effects
    const source = normalizeAddress(operation.source)
    const destination = normalizeAddress(operation.destination)
    const srcAsset = xdrParseAsset(operation.sendAsset)
    const destAsset = xdrParseAsset(operation.destAsset)
    const tradeEffects = processDexOperationEffects(operation, changes, result)

    if (source === destination && srcAsset === destAsset)
        return processPaymentBalanceChanges(source, srcAsset, changes, tradeEffects)

    let srcAmount
    if (!tradeEffects.length) { //direct payment
        if (srcAsset !== destAsset)
            throw new Error('Invalid path payment operation without trade effects')
        //path payment with empty path
        srcAmount = operation.destAmount
    } else {
        srcAmount = isIssuer(source, srcAsset) ?
            calculateTradesSourceAmount(source, srcAsset, changes, tradeEffects) :
            calculateTrustlineBalanceChange(changes, source, srcAsset)
        if (srcAmount <= 0)
            throw new Error('Invalid path payment operation with profitable debit effect')
    }
    return [
        {
            type: effectTypes.accountDebited,
            source,
            asset: srcAsset,
            amount: trimZeros(srcAmount)
        },
        ...tradeEffects,
        {
            type: effectTypes.accountCredited,
            source: destination,
            asset: destAsset,
            amount: trimZeros(operation.destAmount)
        }
    ]
}

function processPathPaymentStrictSendEffects(operation, changes, result) {
    const tradeEffects = processDexOperationEffects(operation, changes, result)

    const source = normalizeAddress(operation.source)
    const destination = normalizeAddress(operation.destination)
    const srcAsset = xdrParseAsset(operation.sendAsset)
    const destAsset = xdrParseAsset(operation.destAsset)

    if (!tradeEffects.length && srcAsset !== destAsset)  //direct payment
        throw new Error('Invalid path payment operation without trade effects')
    if (source === destination && srcAsset === destAsset)
        return processPaymentBalanceChanges(source, srcAsset, changes, tradeEffects)

    return [
        {
            type: effectTypes.accountDebited,
            source: source,
            asset: srcAsset,
            amount: trimZeros(operation.sendAmount)
        },
        ...tradeEffects,
        {
            type: effectTypes.accountCredited,
            source: destination,
            asset: destAsset,
            amount: adjustPrecision(result.payment.amount)
        }
    ]
}

function processDexOperationEffects(operation, changes, result) {
    const effects = []
    const tradingPairsBalances = {}
    //process trades first
    for (const claimedOffer of result.claimedOffers) {
        const amount = claimedOffer.amount.map(adjustPrecision)
        const trade = {
            type: effectTypes.trade,
            source: normalizeAddress(operation.source),
            amount,
            asset: claimedOffer.asset
        }
        if (claimedOffer.poolId) {
            trade.pool = claimedOffer.poolId.toString('hex')
        } else {
            trade.offer = claimedOffer.offerId
            trade.seller = claimedOffer.account
            //detect ghost trades - offer not backed by liabilities removed from DEX
            const tbKey = claimedOffer.account + claimedOffer.asset.join()
            let remaining = tradingPairsBalances[tbKey]
            if (!remaining) {
                //find changed seller trustlines
                remaining = claimedOffer.asset
                    .map(asset => {
                        const v = calculateTrustlineBalanceChange(changes, claimedOffer.account, asset)
                        if (v === '0')
                            return null
                        return v.replace('-', '')
                    })
            } else if (remaining.every(rb => !(rb > 0)))
                continue //offer not backed by liabilities - do not yield trade effect

            tradingPairsBalances[tbKey] = remaining
                .map((rb, i) => rb ? new Bignumber(rb).minus(amount[i]) : null)

        }
        effects.push(trade)
    }

    return [
        ...effects,
        ...processOfferChanges(operation, changes),
        ...processLiquidityPoolChanges(operation, changes)
    ]
}

function processInflationEffects(operation, changes, result) {
    const paymentEffects = (result.inflationPayouts || []).map(ip => ({
        type: effectTypes.accountCredited,
        source: ip.account,
        asset: 'XLM',
        amount: adjustPrecision(ip.amount)
    }))
    return [
        {
            type: effectTypes.inflation,
            source: normalizeAddress(operation.source)
        },
        ...paymentEffects
    ]
}

function processManageDataEffects(operation, changes) {
    if (!changes.length)
        return [] //data entries not updated
    const {action, before, after} = changes.find(ch => ch.type === 'data')
    const effect = {
        type: '',
        source: normalizeAddress(operation.source),
        name: operation.name
    }
    const {sponsor} = after || before
    if (sponsor) {
        effect.sponsor = sponsor
    }
    switch (action) {
        case 'created':
            effect.type = effectTypes.dataEntryCreated
            effect.value = operation.value.toString('base64')
            break
        case 'updated':
            effect.type = effectTypes.dataEntryUpdated
            effect.value = operation.value.toString('base64')
            break
        case 'removed':
            effect.type = effectTypes.dataEntryRemoved
            break
        default:
            throw new UnexpectedMetaChangeError({type, action})
    }
    return [effect]
}

function processBumpSequenceEffects(operation, changes) {
    const {before, after} = changes[0]
    if (before.sequence === after.sequence)
        return []
    return [
        {
            type: effectTypes.sequenceBumped,
            source: normalizeAddress(operation.source),
            sequence: after.sequence
        }
    ]
}

function processCreateClaimableBalanceEffects(operation, changes) {
    const asset = xdrParseAsset(operation.asset)
    return [
        {
            type: effectTypes.accountDebited,
            source: normalizeAddress(operation.source),
            asset,
            amount: trimZeros(operation.amount)
        },
        ...processClaimableBalanceChanges(operation, changes)
    ]
}

function processClaimClaimableBalanceEffects(operation, changes) {
    const {before} = changes.find(ch => ch.type === 'claimableBalance')
    const amount = adjustPrecision(before.amount)
    return [
        {
            type: effectTypes.accountCredited,
            source: normalizeAddress(operation.source),
            asset: before.asset,
            amount
        },
        ...processClaimableBalanceChanges(operation, changes)
    ]
}

function processLiquidityPoolDepositEffects(operation, changes) {
    const {before, after} = changes.find(ch => ch.type === 'liquidityPool' && ch.action === 'updated')
    return [
        {
            type: effectTypes.liquidityPoolDeposited,
            source: normalizeAddress(operation.source),
            pool: operation.liquidityPoolId,
            assets: after.asset.map((asset, i) => ({
                asset,
                amount: adjustPrecision(new Bignumber(after.amount[i]).minus(before.amount[i]).toString())
            })),
            shares: trimZeros(new Bignumber(after.shares).minus(before.shares).toString())
        },
        ...processLiquidityPoolChanges(operation, changes)
    ]
}

function processLiquidityPoolWithdrawEffects(operation, changes) {
    const {before, after} = changes.find(ch => ch.type === 'liquidityPool' && ch.action === 'updated')
    return [
        {
            type: effectTypes.liquidityPoolWithdrew,
            source: normalizeAddress(operation.source),
            pool: before.pool,
            assets: before.asset.map((asset, i) => ({
                asset,
                amount: adjustPrecision(new Bignumber(before.amount[i]).minus(after.amount[i]).toString())
            })),
            shares: trimZeros(new Bignumber(before.shares).minus(after.shares).toString())
        },
        ...processLiquidityPoolChanges(operation, changes)
    ]
}

function processClawbackEffects(operation) {
    const source = normalizeAddress(operation.source)
    const from = normalizeAddress(operation.from)
    const amount = trimZeros(operation.amount)
    if (from === source)
        throw new Error(`Self-clawback attempt`)
    const asset = xdrParseAsset(operation.asset)
    if (!isIssuer(source, asset)) {
        throw new Error(`Attempt to clawback asset ${asset} by account ${source}`)
    }
    return [
        {
            type: effectTypes.accountDebited,
            source: from,
            asset,
            amount
        },
        {
            type: effectTypes.accountCredited,
            source,
            asset,
            amount
        }
    ]
}

function processClawbackClaimableBalanceEffects(operation, changes) {
    const {before} = changes.find(ch => ch.type === 'claimableBalance')
    const amount = adjustPrecision(before.amount)
    return [
        {
            type: effectTypes.accountCredited,
            source: normalizeAddress(operation.source),
            asset: before.asset,
            amount
        },
        ...processClaimableBalanceChanges(operation, changes)
    ]
}

function processSponsorshipEffects(operation, changes) {
    for (const change of changes) {
        const {type, action, before, after} = change
        const effect = {
            type: encodeSponsorshipEffectName(action, type),
            source: normalizeAddress(operation.source)
        }
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
            default:
                throw new UnexpectedMetaChangeError(change)
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
            default:
                throw new UnexpectedMetaChangeError(change)
        }
        operation.effects.push(effect)
    }
}

function processSignerSponsorshipEffects(operation, changes) {
    if (operation.type !== 'setOptions' && operation.type !== 'revokeSignerSponsorship')
        return //other operations do not yield signer sponsorship effects

    for (const {type, action, before, after} of changes) {
        if (type !== 'account' || action !== 'updated' || !before.signerSponsoringIDs?.length && !after.signerSponsoringIDs?.length)
            continue
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
                operation.effects.push({
                    type: effectTypes.signerSponsorshipRemoved,
                    source: normalizeAddress(operation.source),
                    account: before.address,
                    signer: signerKey,
                    prevSponsor: beforeMap[signerKey]
                })
                break
            }
            if (newSponsor !== beforeMap[signerKey]) {
                operation.effects.push({
                    type: effectTypes.signerSponsorshipUpdated,
                    source: normalizeAddress(operation.source),
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
                operation.effects.push({
                    type: effectTypes.signerSponsorshipCreated,
                    source: normalizeAddress(operation.source),
                    account: after.address,
                    signer: signerKey,
                    sponsor: afterMap[signerKey]
                })
                break
            }
        }
    }
}

function processPaymentBalanceChanges(source, asset, changes, tradeEffects, defaultAmount = null) {
    const balanceChange = isIssuer(source, asset) ?
        calculateTradesSourceAmount(source, asset, changes, tradeEffects, defaultAmount) :
        calculateTrustlineBalanceChange(changes, source, asset)
    const effects = tradeEffects || []
    if (balanceChange !== '0') {
        if (balanceChange > 0) {
            effects.push({
                type: effectTypes.accountDebited,
                source,
                asset,
                amount: balanceChange
            })
        } else {
            effects.push({
                type: effectTypes.accountCredited,
                source,
                asset,
                amount: balanceChange.replace('-', '') //strip leading "-"
            })
        }
    }
    return effects
}

function processLiquidityPoolChanges(operation, changes) {
    const effects = []
    for (const change of changes)
        if (change.type === 'liquidityPool') {
            const {action, before, after} = change
            const snapshot = after || before
            const effect = {
                type: effectTypes.liquidityPoolRemoved,
                source: normalizeAddress(operation.source),
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
                    break
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
            effects.push(effect)
        }
    return effects
}

function processTrustlineEffectsChanges(operation, changes) {
    const effects = []
    for (const change of changes)
        if (change.type === 'trustline') {
            const {action, before, after} = change
            const snapshot = (after || before)
            const trustEffect = {
                type: effectTypes.trustlineRemoved,
                source: snapshot.account,
                asset: snapshot.asset
            }
            if (snapshot.sponsor) {
                trustEffect.sponsor = snapshot.sponsor
            }
            switch (action) {
                case 'created':
                    trustEffect.type = effectTypes.trustlineCreated
                    trustEffect.limit = adjustPrecision(snapshot.limit)
                    trustEffect.flags = snapshot.flags
                    break
                case 'updated':
                    if (before.limit === after.limit && before.flags === after.flags)
                        continue
                    trustEffect.type = effectTypes.trustlineUpdated
                    trustEffect.limit = adjustPrecision(snapshot.limit)
                    trustEffect.flags = snapshot.flags
                    break
            }
            effects.push(trustEffect)
            break
        }
    return effects
}

function processOfferChanges(operation, changes) {
    const effects = []
    for (const change of changes)
        if (change.type === 'offer') {
            const {action, before, after} = change
            const snapshot = after || before
            const effect = {
                type: effectTypes.offerRemoved,
                source: normalizeAddress(operation.source),
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
                    effect.type = effectTypes.offerUpdated
                    effect.amount = adjustPrecision(after.amount)
                    effect.price = after.price
                    break
            }
            effects.push(effect)
        }
    return effects
}

function processClaimableBalanceChanges(operation, changes) {
    const effects = []
    for (const change of changes)
        if (change.type === 'claimableBalance') {
            const source = normalizeAddress(operation.source)
            const {action, before, after} = change
            switch (action) {
                case 'created':
                    effects.push({
                        type: effectTypes.claimableBalanceCreated,
                        source,
                        sponsor: after.sponsor,
                        balance: after.balanceId,
                        asset: after.asset,
                        amount: adjustPrecision(after.amount),
                        claimants: after.claimants
                    })
                    break
                case 'removed':
                    effects.push({
                        type: effectTypes.claimableBalanceRemoved,
                        source,
                        sponsor: before.sponsor,
                        balance: before.balanceId,
                        asset: before.asset,
                        amount: adjustPrecision(before.amount),
                        claimants: before.claimants
                    })
                    break
                default:
                    throw new UnexpectedMetaChangeError(change)
            }

        }
    return effects
}

function noEffects() {
    return []
}

module.exports = {analyzeOperationEffects, processFeeChargedEffect}
