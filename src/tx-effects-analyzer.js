const Bignumber = require('bignumber.js')
const {parseLedgerEntryChanges} = require('./ledger-entry-changes-parser')
const {xdrParseAsset, xdrParseClaimantPredicate} = require('./tx-xdr-parser-utils')

/**
 * All possible effects types
 * @readonly
 */
const effectTypes = {
    feeCharged: 'feeCharged',

    accountCreated: 'accountCreated',
    accountRemoved: 'accountRemoved',

    accountDebited: 'accountDebited',
    accountCredited: 'accountCredited',

    accountHomeDomainUpdated: 'accountHomeDomainUpdated',
    accountThresholdsUpdated: 'accountThresholdsUpdated',
    accountFlagsUpdated: 'accountFlagsUpdated',
    accountInflationDestinationUpdated: 'accountInflationDestinationUpdated',

    accountSignerUpdated: 'accountSignerUpdated',
    accountSignerRemoved: 'accountSignerRemoved',
    accountSignerCreated: 'accountSignerCreated',

    trustlineCreated: 'trustlineCreated',
    trustlineUpdated: 'trustlineUpdated',
    trustlineRemoved: 'trustlineRemoved',
    trustlineAuthorizationUpdated: 'trustlineAuthorizationUpdated',

    liquidityPoolCreated: 'liquidityPoolCreated',
    liquidityPoolUpdated: 'liquidityPoolUpdated',
    liquidityPoolRemoved: 'liquidityPoolRemoved',

    offerCreated: 'offerCreated',
    offerUpdated: 'offerUpdated',
    offerRemoved: 'offerRemoved',

    trade: 'trade',

    inflation: 'inflation',

    sequenceBumped: 'sequenceBumped',

    dataEntryCreated: 'dataEntryCreated',
    dataEntryUpdated: 'dataEntryUpdated',
    dataEntryRemoved: 'dataEntryRemoved',

    claimableBalanceCreated: 'claimableBalanceCreated',
    claimableBalanceRemoved: 'claimableBalanceRemoved',

    liquidityPoolDeposited: 'liquidityPoolDeposited',
    liquidityPoolWithdrew: 'liquidityPoolWithdrew',

    accountSponsorshipCreated: 'accountSponsorshipCreated',
    accountSponsorshipUpdated: 'accountSponsorshipUpdated',
    accountSponsorshipRemoved: 'accountSponsorshipRemoved',

    trustlineSponsorshipCreated: 'trustlineSponsorshipCreated',
    trustlineSponsorshipUpdated: 'trustlineSponsorshipUpdated',
    trustlineSponsorshipRemoved: 'trustlineSponsorshipRemoved',

    liquidityPoolStakeSponsorshipCreated: 'liquidityPoolStakeSponsorshipCreated',
    liquidityPoolStakeSponsorshipUpdated: 'liquidityPoolStakeSponsorshipUpdated',
    liquidityPoolStakeSponsorshipRemoved: 'liquidityPoolStakeSponsorshipRemoved',

    offerSponsorshipCreated: 'offerSponsorshipCreated',
    offerSponsorshipUpdated: 'offerSponsorshipUpdated',
    offerSponsorshipRemoved: 'offerSponsorshipRemoved',

    dataSponsorshipCreated: 'dataSponsorshipCreated',
    dataSponsorshipUpdated: 'dataSponsorshipUpdated',
    dataSponsorshipRemoved: 'dataSponsorshipRemoved',

    claimableBalanceSponsorshipCreated: 'claimableBalanceSponsorshipCreated',
    claimableBalanceSponsorshipUpdated: 'claimableBalanceSponsorshipUpdated',
    claimableBalanceSponsorshipRemoved: 'claimableBalanceSponsorshipRemoved',

    liquidityPoolSponsorshipCreated: 'liquidityPoolSponsorshipCreated',
    liquidityPoolSponsorshipUpdated: 'liquidityPoolSponsorshipUpdated',
    liquidityPoolSponsorshipRemoved: 'liquidityPoolSponsorshipRemoved',

    signerSponsorshipRemoved: 'signerSponsorshipRemoved',
    signerSponsorshipUpdated: 'signerSponsorshipUpdated',
    signerSponsorshipCreated: 'signerSponsorshipCreated'
}

/**
 * Processes operation effects and returns them
 * @param {{operation: any, meta: any, result: any}} operationData - operation data
 * @returns {any[]} - operation effects
 */
function analyzeOperationEffects({operation, meta, result}) {
    //TODO: check that operation always has correct source account
    if (!operation.source)
        throw new Error('Operation source is not defined')
    const processEffects = effectProcessorMap[operation.type]
    const changes = parseLedgerEntryChanges(meta)
    operation.effects = processEffects({
        operation,
        changes,
        result
    })
    processSponsorshipEffects({operation, changes})
    processSignerSponsorshipEffects({operation, changes})
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
    const res = {
        type: effectTypes.feeCharged,
        source: tx.feeSource || tx.source,
        asset: 'XLM',
        bid: adjustPrecision(tx.fee),
        charged: adjustPrecision(chargedAmount)
    }
    if (feeBump) {
        res.bump = true
    }
    return res
}

function processCreateAccountEffects({operation, changes}) {
    const accountCreated = {
        type: effectTypes.accountCreated,
        source: operation.source,
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
            source: operation.source,
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

function processMergeAccountEffects({operation, changes, result}) {
    const accountRemoved = {
        type: effectTypes.accountRemoved,
        source: operation.source
    }
    const {before} = changes.find(c => c.type === 'account' && c.action === 'removed')
    if (before.sponsor) {
        accountRemoved.sponsor = before.sponsor
    }
    if (parseFloat(result.actualMergedAmount) === 0)
        return [accountRemoved]
    return [
        {
            type: effectTypes.accountDebited,
            source: operation.source,
            asset: 'XLM',
            amount: adjustPrecision(result.actualMergedAmount)
        },
        {
            type: effectTypes.accountCredited,
            source: operation.destination,
            asset: 'XLM',
            amount: adjustPrecision(result.actualMergedAmount)
        },
        accountRemoved
    ]
}

function processSetOptionsEffects({operation, changes}) {
    const effects = []
    const {before, after} = changes.find(ch => ch.type === 'account' && ch.before.address === operation.source)
    if (before.homeDomain !== after.homeDomain) {
        effects.push({
            type: effectTypes.accountHomeDomainUpdated,
            source: operation.source,
            domain: after.homeDomain
        })
    }
    if (JSON.stringify(before.thresholds) !== JSON.stringify(after.thresholds)) {
        effects.push({
            type: effectTypes.accountThresholdsUpdated,
            source: operation.source,
            thresholds: after.thresholds
        })
    }
    if (before.flags !== after.flags) {
        effects.push({
            type: effectTypes.accountFlagsUpdated,
            source: operation.source,
            flags: after.flags
        })
    }
    if (before.inflationDest !== after.inflationDest) {
        effects.push({
            type: effectTypes.accountInflationDestinationUpdated,
            source: operation.source,
            inflationDestination: after.inflationDest
        })
    }
    if (operation.masterWeight !== undefined && before.masterWeight !== after.masterWeight) {
        if (operation.masterWeight > 0) {
            effects.push({
                type: effectTypes.accountSignerUpdated,
                source: operation.source,
                signer: after.address,
                weight: after.masterWeight,
                masterWeight: after.masterWeight,
                signers: after.signers
            })
        } else {
            effects.push({
                type: effectTypes.accountSignerRemoved,
                source: operation.source,
                signer: after.address,
                weight: after.masterWeight,
                masterWeight: after.masterWeight,
                signers: after.signers
            })
        }
    }
    if (operation.signer !== undefined && JSON.stringify(before.signers) !== JSON.stringify(after.signers)) {
        const weight = operation.signer.weight || 0
        const key = operation.signer.ed25519PublicKey || operation.signer.sha256Hash || operation.signer.preAuthTx || operation.signer.ed25519SignedPayload
        if (weight === 0) {
            effects.push({
                type: effectTypes.accountSignerRemoved,
                source: operation.source,
                signer: key,
                weight,
                masterWeight: after.masterWeight,
                signers: after.signers
            })
        } else if (before.signers.length < after.signers.length) {
            effects.push({
                type: effectTypes.accountSignerCreated,
                source: operation.source,
                signer: key,
                weight,
                masterWeight: after.masterWeight,
                signers: after.signers
            })
        } else {
            effects.push({
                type: effectTypes.accountSignerUpdated,
                source: operation.source,
                signer: key,
                weight,
                masterWeight: after.masterWeight,
                signers: after.signers
            })
        }
    }
    return effects
}

function processChangeTrustEffects({operation, changes}) {
    return [
        ...processLiquidityPoolChanges({operation, changes}),
        ...processTrustlineEffectsChanges({operation, changes})
    ]
}

function processAllowTrustEffects({operation, changes}) {
    if (!changes.length)
        return []
    const trustlineChange = changes.find(ch => ch.type === 'trustline')
    const effects = []
    if (trustlineChange) {
        const {before, after} = trustlineChange
        if (before.flags !== after.flags) {
            effects.push({
                type: effectTypes.trustlineAuthorizationUpdated,
                source: operation.source,
                trustor: operation.trustor,
                asset: after.asset,
                flags: after.flags,
                prevFlags: before.flags
            })
        }
    }

    return [
        ...effects,
        ...processTrustlineEffectsChanges({operation, changes}),
        ...processLiquidityPoolChanges({operation, changes}),
        ...processOfferChanges({operation, changes}),
        ...processClaimableBalanceChanges({operation, changes})
    ]
}

function processPaymentEffects({operation}) {
    if (operation.source === operation.destination)
        return [] //self-transfer
    const asset = xdrParseAsset(operation.asset)
    return [
        {
            type: effectTypes.accountDebited,
            source: operation.source,
            asset,
            amount: trimZeros(operation.amount)
        },
        {
            type: effectTypes.accountCredited,
            source: operation.destination,
            asset,
            amount: trimZeros(operation.amount)
        }
    ]
}

function processPathPaymentStrictReceiveEffects({operation, changes, result}) {
    if (!changes.length)
        return [] //self-transfer without effects
    const tradeEffects = processDexOperationEffects({operation, changes, result})
    const trades = tradeEffects.filter(e => e.type === effectTypes.trade)
    const srcAmounts = []
    for (let i = 0; i < trades.length; i++) {
        const {amount, asset} = trades[i]
        if (i > 0 && trades[i - 1].asset.join() !== asset.join())
            break
        srcAmounts.push(amount[1])
    }
    const srcAmount = trimZeros(srcAmounts.reduce((prev, v) => prev.add(v), new Bignumber(0)).toFixed(7))
    return [
        {
            type: effectTypes.accountDebited,
            source: operation.source,
            asset: xdrParseAsset(operation.sendAsset),
            amount: srcAmount
        },
        ...tradeEffects,
        {
            type: effectTypes.accountCredited,
            source: operation.destination,
            asset: xdrParseAsset(operation.destAsset),
            amount: trimZeros(operation.destAmount)
        }
    ]
}

function processPathPaymentStrictSendEffects({operation, changes, result}) {
    if (!changes.length)
        return [] //self-transfer without effects
    const tradeEffects = processDexOperationEffects({operation, changes, result})
    return [
        {
            type: effectTypes.accountDebited,
            source: operation.source,
            asset: xdrParseAsset(operation.sendAsset),
            amount: trimZeros(operation.sendAmount)
        },
        ...tradeEffects,
        {
            type: effectTypes.accountCredited,
            source: operation.destination,
            asset: xdrParseAsset(operation.destAsset),
            amount: adjustPrecision(result.payment.amount)
        }
    ]
}

function processDexOperationEffects({operation, changes, result}) {
    const effects = []
    //process trades first
    for (const claimedOffer of result.claimedOffers) {
        const trade = {
            type: effectTypes.trade,
            source: operation.source,
            amount: claimedOffer.amount.map(adjustPrecision),
            asset: claimedOffer.asset
        }
        if (claimedOffer.poolId) {
            trade.pool = claimedOffer.poolId.toString('hex')
        } else {
            trade.offer = claimedOffer.offerId
            trade.seller = claimedOffer.account
        }
        effects.push(trade)
    }

    return [
        ...effects,
        ...processOfferChanges({operation, changes}),
        ...processLiquidityPoolChanges({operation, changes})
    ]
}

function processInflationEffects({operation, result}) {
    const paymentEffects = (result.inflationPayouts || []).map(ip => ({
        type: effectTypes.accountCredited,
        source: ip.account,
        asset: 'XLM',
        amount: adjustPrecision(ip.amount)
    }))
    return [
        {
            type: effectTypes.inflation,
            source: operation.source
        },
        ...paymentEffects
    ]
}

function processManageDataEffects({operation, changes}) {
    if (!changes.length)
        return [] //data entries not updated
    const {action, before, after} = changes.find(ch => ch.type === 'data')
    const effect = {
        type: '',
        source: operation.source,
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
            throw new UnexpectedMetaChangeError(change)
    }
    return [effect]
}

function processBumpSequenceEffects({operation, changes}) {
    const {before, after} = changes[0]
    if (before.sequence === after.sequence)
        return []
    return [
        {
            type: effectTypes.sequenceBumped,
            source: operation.source,
            sequence: after.sequence
        }
    ]
}

function processCreateClaimableBalanceEffects({operation, changes}) {
    const asset = xdrParseAsset(operation.asset)
    return [
        {
            type: effectTypes.accountDebited,
            source: operation.source,
            asset,
            amount: trimZeros(operation.amount)
        },
        ...processClaimableBalanceChanges({operation, changes})
    ]
}

function processClaimClaimableBalanceEffects({operation, changes}) {
    const {before} = changes.find(ch => ch.type === 'claimableBalance')
    const amount = adjustPrecision(before.amount)
    return [
        {
            type: effectTypes.accountCredited,
            source: operation.source,
            asset: before.asset,
            amount
        },
        ...processClaimableBalanceChanges({operation, changes})
    ]
}

function processLiquidityPoolDepositEffects({operation, changes}) {
    const {before, after} = changes.find(ch => ch.type === 'liquidityPool' && ch.action === 'updated')
    return [
        {
            type: effectTypes.liquidityPoolDeposited,
            source: operation.source,
            pool: operation.liquidityPoolId,
            assets: after.asset.map((asset, i) => ({
                asset,
                amount: adjustPrecision(new Bignumber(after.amount[i]).minus(before.amount[i]))
            })),
            shares: trimZeros(new Bignumber(after.shares).minus(before.shares).toFixed(7))
        },
        ...processLiquidityPoolChanges({operation, changes})
    ]
}

function processLiquidityPoolWithdrawEffects({operation, changes}) {
    const {before, after} = changes.find(ch => ch.type === 'liquidityPool' && ch.action === 'updated')
    return [
        {
            type: effectTypes.liquidityPoolWithdrew,
            source: operation.source,
            pool: before.pool,
            assets: before.asset.map((asset, i) => ({
                asset,
                amount: adjustPrecision(new Bignumber(before.amount[i]).minus(after.amount[i]))
            })),
            shares: trimZeros(new Bignumber(before.shares).minus(after.shares).toFixed(7))
        },
        ...processLiquidityPoolChanges({operation, changes})
    ]
}

function processClawbackEffects({operation}) {
    if (operation.from === operation.source)
        return []
    const asset = xdrParseAsset(operation.asset)
    if (!asset.includes(operation.source))
        throw new Error(`Asset ${asset} clawed back by account ${operation.source}`)
    return [
        {
            type: effectTypes.accountDebited,
            source: operation.from,
            asset,
            amount: trimZeros(operation.amount)
        },
        {
            type: effectTypes.accountCredited,
            source: operation.source,
            asset,
            amount: trimZeros(operation.amount)
        }
    ]
}

function processClawbackClaimableBalanceEffects({operation, changes}) {
    const {before} = changes.find(ch => ch.type === 'claimableBalance')
    const amount = adjustPrecision(before.amount)
    return [
        {
            type: effectTypes.accountCredited,
            source: operation.source,
            asset: before.asset,
            amount
        },
        ...processClaimableBalanceChanges({operation, changes})
    ]
}

function getSponsorshipEffect(action, type) {
    switch (action) {
        case 'created':
            return effectTypes[`${type}SponsorshipCreated`]
        case 'updated':
            return effectTypes[`${type}SponsorshipUpdated`]
        case 'removed':
            return effectTypes[`${type}SponsorshipRemoved`]
        default:
            throw new UnexpectedMetaChangeError({action, type})
    }
}

function processSponsorshipEffects({operation, changes}) {
    for (const change of changes) {
        const {type, action, before, after} = change
        const effect = {
            type: getSponsorshipEffect(action, type),
            source: operation.source
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
            case 'liquidityPoolStake':
                effect.account = before?.account || after?.account
                effect.pool = before?.pool || after?.pool
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

function processSignerSponsorshipEffects({operation, changes}) {
    if (!['revokeSignerSponsorship', 'setOptions'].includes(operation.type))
        return
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
                    source: operation.source,
                    account: before.address,
                    signer: signerKey,
                    prevSponsor: beforeMap[signerKey]
                })
                break
            }
            if (newSponsor !== beforeMap[signerKey]) {
                operation.effects.push({
                    type: effectTypes.signerSponsorshipUpdated,
                    source: operation.source,
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
                    source: operation.source,
                    account: after.address,
                    signer: signerKey,
                    sponsor: afterMap[signerKey]
                })
                break
            }
        }
    }
}

function processLiquidityPoolChanges({operation, changes}) {
    const effects = []
    for (const change of changes)
        if (change.type === 'liquidityPool') {
            const {action, before, after} = change
            const snapshot = after || before
            const effect = {
                type: effectTypes.liquidityPoolRemoved,
                source: operation.source,
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

function processTrustlineEffectsChanges({operation, changes}) {
    const effects = []
    for (const change of changes)
        if (change.type === 'liquidityPoolStake' || change.type === 'trustline') {
            const {type, action, before, after} = change
            const snapshot = (after || before)
            const trustedAsset = type === 'liquidityPoolStake' ? snapshot.pool : snapshot.asset
            const source = snapshot.account
            const trustEffect = {
                type: effectTypes.trustlineRemoved,
                source: source,
                asset: trustedAsset
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

function processOfferChanges({operation, changes}) {
    const effects = []
    for (const change of changes)
        if (change.type === 'offer') {
            const {action, before, after} = change
            const snapshot = after || before
            const effect = {
                type: effectTypes.offerRemoved,
                source: operation.source,
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

function processClaimableBalanceChanges({operation, changes}) {
    const effects = []
    for (const change of changes)
        if (change.type === 'claimableBalance') {
            const {action, before, after} = change
            switch (action) {
                case 'created':
                    effects.push({
                        type: effectTypes.claimableBalanceCreated,
                        source: operation.source,
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
                        source: operation.source,
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

function adjustPrecision(value) {
    if (value === '0')
        return value
    return trimZeros(new Bignumber(value).div(10000000).toFixed(7))
}

function trimZeros(value) {
    let [integer, fractional] = value.split('.')
    if (!fractional)
        return value
    fractional = fractional.replace(/0+$/, '')
    if (!fractional)
        return integer
    return integer + '.' + fractional
}

class UnexpectedMetaChangeError extends Error {
    constructor(change) {
        super(`Unexpected meta changes: "${change.type}" "${change.action}"`)
    }
}

module.exports = {analyzeOperationEffects, processFeeChargedEffect, effectTypes}
