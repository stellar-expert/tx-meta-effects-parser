const Bignumber = require('bignumber.js')
const {parseLedgerEntryChanges} = require('./ledger-entry-changes-parser')
const {xdrParseAsset, xdrParseClaimantPredicate} = require('./tx-xdr-parser-utils')

const effectTypes = {
    feeCharged: "feeCharged",
    accountCreated: "accountCreated",
    accountDebited: "accountDebited",
    accountCredited: "accountCredited",
    accountRemoved: "accountRemoved",
    accountHomeDomainUpdated: "accountHomeDomainUpdated",
    accountThresholdsUpdated: "accountThresholdsUpdated",
    accountFlagsUpdated: "accountFlagsUpdated",
    accountInflationDestinationUpdated: "accountInflationDestinationUpdated",
    accountSignerUpdated: "accountSignerUpdated",
    accountSignerRemoved: "accountSignerRemoved",
    accountSignerCreated: "accountSignerCreated",
    trustlineRemoved: "trustlineRemoved",
    liquidityPoolRemoved: "liquidityPoolRemoved",
    trustlineCreated: "trustlineCreated",
    trustlineUpdated: "trustlineUpdated",
    liquidityPoolCreated: "liquidityPoolCreated",
    trustlineAuthorizationUpdated: "trustlineAuthorizationUpdated",
    trustlineDeauthorized: "trustlineDeauthorized",
    trade: "trade",
    liquidityPoolUpdated: "liquidityPoolUpdated",
    offerCreated: "offerCreated",
    offerUpdated: "offerUpdated",
    offerRemoved: "offerRemoved",
    inflation: "inflation",
    dataEntryCreated: "dataEntryCreated",
    dataEntryUpdated: "dataEntryUpdated",
    dataEntryRemoved: "dataEntryRemoved",
    sequenceBumped: "sequenceBumped",
    claimableBalanceCreated: "claimableBalanceCreated",
    claimableBalanceRemoved: "claimableBalanceRemoved",
    liquidityPoolDeposited: "liquidityPoolDeposited",
    liquidityPoolWithdrew: "liquidityPoolWithdrew",

    accountSponsorshipCreated: "accountSponsorshipCreated",
    accountSponsorshipUpdated: "accountSponsorshipUpdated",
    accountSponsorshipRemoved: "accountSponsorshipRemoved",

    trustlineSponsorshipCreated: "trustlineSponsorshipCreated",
    trustlineSponsorshipUpdated: "trustlineSponsorshipUpdated",
    trustlineSponsorshipRemoved: "trustlineSponsorshipRemoved",

    liquidityPoolStakeSponsorshipCreated: "liquidityPoolStakeSponsorshipCreated",
    liquidityPoolStakeSponsorshipUpdated: "liquidityPoolStakeSponsorshipUpdated",
    liquidityPoolStakeSponsorshipRemoved: "liquidityPoolStakeSponsorshipRemoved",

    offerSponsorshipCreated: "offerSponsorshipCreated",
    offerSponsorshipUpdated: "offerSponsorshipUpdated",
    offerSponsorshipRemoved: "offerSponsorshipRemoved",

    dataSponsorshipCreated: "dataSponsorshipCreated",
    dataSponsorshipUpdated: "dataSponsorshipUpdated",
    dataSponsorshipRemoved: "dataSponsorshipRemoved",

    claimableBalanceSponsorshipCreated: "claimableBalanceSponsorshipCreated",
    claimableBalanceSponsorshipUpdated: "claimableBalanceSponsorshipUpdated",
    claimableBalanceSponsorshipRemoved: "claimableBalanceSponsorshipRemoved",

    liquidityPoolSponsorshipCreated: "liquidityPoolSponsorshipCreated",
    liquidityPoolSponsorshipUpdated: "liquidityPoolSponsorshipUpdated",
    liquidityPoolSponsorshipRemoved: "liquidityPoolSponsorshipRemoved",

    signerSponsorshipRemoved: "signerSponsorshipRemoved",
    signerSponsorshipUpdated: "signerSponsorshipUpdated",
    signerSponsorshipCreated: "signerSponsorshipCreated"
}

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
    beginSponsoringFutureReserves: empty,
    endSponsoringFutureReserves: empty,
    revokeSponsorship: empty,
    revokeAccountSponsorship: empty,
    revokeTrustlineSponsorship: empty,
    revokeOfferSponsorship: empty,
    revokeDataSponsorship: empty,
    revokeClaimableBalanceSponsorship: empty,
    revokeLiquidityPoolSponsorship: empty,
    revokeSignerSponsorship: empty
}

function processFeeChargedEffect(tx, chargedAmount, feeBump = false) {
    const res = {
        type: effectTypes.feeCharged,
        source: tx.feeSource || tx.source,
        asset: 'XLM',
        feeBid: adjustPrecision(tx.fee),
        charged: adjustPrecision(chargedAmount)

    }
    if (feeBump) {
        res.isFeeBump = true
    }
    return res
}

function processCreateAccountEffects({operation}) {
    const effect = {
        type: effectTypes.accountCreated,
        source: operation.source,
        account: operation.destination
    }
    if (parseFloat(operation.startingBalance) === 0)
        return [effect]
    return [
        effect,
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

function processMergeAccountEffects({operation, result}) {
    const removedEffect = {
        type: effectTypes.accountRemoved,
        source: operation.source,
        account: operation.source
    }
    if (parseFloat(result.actualMergedAmount) === 0)
        return [removedEffect]
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
        removedEffect
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
        const weight = parseInt(operation.signer.weight || 0, 10)
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
    const trustChange = changes.find(ch => ch.type === 'trustline' || ch.type === 'liquidityPoolStake')
    const trustedAsset = operation.line.fee ? (trustChange.before || trustChange.after).pool : xdrParseAsset(operation.line)
    const trustEffect = {
        type: '',
        source: operation.source,
        asset: trustedAsset
    }

    const effects = [trustEffect]
    if (parseFloat(operation.limit) === 0) {
        trustEffect.type = effectTypes.trustlineRemoved
        if (trustChange.type === 'liquidityPoolStake' && changes.some(ch => ch.type === 'liquidityPool' && ch.action === 'removed')) {
            effects.push({
                type: effectTypes.liquidityPoolRemoved,
                source: operation.source,
                pool: trustedAsset
            })
        }
    } else {
        trustEffect.type = trustChange.action === 'created' ? effectTypes.trustlineCreated : effectTypes.trustlineUpdated
        trustEffect.limit = trimZeros(operation.limit)
        if (trustChange.type === 'liquidityPoolStake') {
            const lpChange = changes.find(ch => ch.type === 'liquidityPool' && ch.action === 'created')
            if (lpChange) {
                effects.push({
                    type: effectTypes.liquidityPoolCreated,
                    source: operation.source,
                    pool: trustedAsset,
                    reserves: lpChange.after.asset.map(asset => ({asset, amount: '0'})),
                    shares: '0'
                })
            }
        }
    }
    return effects
}

function processAllowTrustEffects({operation, changes}) {
    let effectType
    if (!changes.length)
        return []

    if (operation.flags) {
        if (operation.flags.authorized || operation.flags.authorizedToMaintainLiabilities || operation.flags.clawbackEnabled) {
            effectType = effectTypes.trustlineAuthorizationUpdated
        } else {
            effectType = effectTypes.trustlineDeauthorized
        }
    } else {
        switch (operation.authorize) {
            case false:
            case 0:
                effectType = effectTypes.trustlineDeauthorized
                break
            case true:
            case 1:
            default:
                effectType = effectTypes.trustlineAuthorizationUpdated
                break
        }
    }
    const {after} = changes[0]
    return [{
        type: effectType,
        source: operation.source,
        trustor: operation.trustor,
        asset: after.asset,
        flags: after.flags
    }]
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
    const srcAmount = srcAmounts.reduce((prev, v) => prev.add(v), new Bignumber(0)).toString()
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
    for (const {action, type, before, after} of changes) {
        //add trade effect
        if (type === 'liquidityPool' || type === 'offer' && action !== 'created') {
            const id = before?.id || after?.id
            const claimedOffer = result.claimedOffers.find(co => co.offerId === id)
            const trade = {
                type: effectTypes.trade,
                source: operation.source,
                amount: claimedOffer.amount.map(adjustPrecision),
                asset: claimedOffer.asset
            }
            if (type === 'liquidityPool') {
                trade.pool = before.pool
            } else {
                trade.offer = before.id
                trade.seller = before.account
            }
            effects.push(trade)
        }
        switch (type) {
            case 'liquidityPool':
                effects.push({ //updated token amount after the trade against a liquidity
                    type: effectTypes.liquidityPoolUpdated,
                    source: operation.source,
                    amount: after.amount.map(adjustPrecision),
                    asset: after.asset,
                    price: new Bignumber(after.amount[0]).div(new Bignumber(after.amount[1])).toNumber(),
                    shares: after.shares,
                    accounts: parseInt(after.accounts, 10)
                })
                break
            case 'offer':
                switch (action) {
                    case 'created': //new offer created as a result of manage offer operation
                        effects.push({
                            type: effectTypes.offerCreated,
                            source: operation.source,
                            owner: after.account,
                            offer: after.id,
                            amount: adjustPrecision(after.amount),
                            asset: after.asset,
                            price: after.price,
                            flags: after.flags
                        })
                        break
                    case 'updated': //offer changed as a result of a trade
                        effects.push({
                            type: effectTypes.offerUpdated,
                            source: operation.source,
                            owner: after.account,
                            offer: after.id,
                            amount: adjustPrecision(after.amount),
                            asset: after.asset,
                            price: after.price,
                            flags: after.flags
                        })
                        break
                    case 'removed': //offer removed - either as a result of trade or canceling operation
                        effects.push({
                            type: effectTypes.offerRemoved,
                            source: operation.source,
                            owner: before.account,
                            offer: before.id,
                            asset: before.asset,
                            flags: before.flags
                        })
                        break
                }
                break
            case 'account':
            case 'trustline':
                //no need to process these ledger entry types - skip
                break
            default:
                throw new UnexpectedMetaChangeError({action, type})
        }
    }
    return effects
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
    const change = changes.find(ch => ch.type === 'data')
    const effect = {
        type: '',
        source: operation.source,
        name: operation.name
    }
    switch (change.action) {
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

function processCreateClaimableBalanceEffects({operation, result}) {
    const asset = xdrParseAsset(operation.asset)
    return [
        {
            type: effectTypes.accountDebited,
            source: operation.source,
            asset,
            amount: trimZeros(operation.amount)
        },
        {
            type: effectTypes.claimableBalanceCreated,
            source: operation.source,
            balance: result.balanceId,
            asset,
            amount: trimZeros(operation.amount),
            claimants: operation.claimants.map(c => ({
                destination: c.destination,
                predicate: xdrParseClaimantPredicate(c.predicate)
            }))
        }
    ]
}

function processClaimClaimableBalanceEffects({operation, changes}) {
    const {before} = changes.find(ch => ch.type === 'claimableBalance')
    return [
        {
            type: effectTypes.accountCredited,
            source: operation.source,
            asset: before.asset,
            amount: adjustPrecision(before.amount)
        },
        {
            type: effectTypes.claimableBalanceRemoved,
            source: operation.source,
            balance: before.balanceId
        }
    ]
}

function processLiquidityPoolDepositEffects({operation, changes}) {
    const effects = []
    for (const {action, type, before, after} of changes) {
        if (type !== 'liquidityPool')
            continue
        switch (action) {
            case 'updated':
                effects.push({
                    type: effectTypes.liquidityPoolDeposited,
                    source: operation.source,
                    pool: operation.liquidityPoolId,
                    assets: after.asset.map((asset, i) => ({
                        asset,
                        amount: adjustPrecision(new Bignumber(after.amount[i]).minus(before.amount[i]))
                    })),
                    shares: new Bignumber(after.shares).minus(before.shares).toString()
                })
                effects.push({
                    type: effectTypes.liquidityPoolUpdated,
                    source: operation.source,
                    pool: operation.liquidityPoolId,
                    reserves: after.asset.map((asset, i) => ({
                        asset,
                        amount: adjustPrecision(after.amount[i])
                    })),
                    shares: after.shares
                })
                break
            default:
                throw new UnexpectedMetaChangeError({action, type})
        }

    }
    return effects
}

function processLiquidityPoolWithdrawEffects({operation, changes}) {
    const effects = []
    for (const ch of changes) {
        if (ch.type !== 'liquidityPool')
            continue
        const {action, before, after} = ch
        switch (action) {
            case 'updated':
                effects.push({
                    type: effectTypes.liquidityPoolWithdrew,
                    source: operation.source,
                    pool: operation.liquidityPoolId,
                    assets: before.asset.map((asset, i) => ({
                        asset,
                        amount: adjustPrecision(new Bignumber(before.amount[i]).minus(after.amount[i]))
                    })),
                    shares: new Bignumber(before.shares).minus(after.shares).toString()
                })
                effects.push({
                    type: effectTypes.liquidityPoolUpdated,
                    source: operation.source,
                    pool: operation.liquidityPoolId,
                    reserves: after.asset.map((asset, i) => ({
                        asset,
                        amount: adjustPrecision(after.amount[i])
                    })),
                    shares: after.shares
                })
                break
            default:
                throw new UnexpectedMetaChangeError(ch)
        }
    }
    return effects
}

function processClawbackEffects({operation}) {
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
    return [
        {
            type: effectTypes.accountCredited,
            source: operation.source,
            asset: before.asset,
            amount: adjustPrecision(before.amount)
        },
        {
            type: effectTypes.claimableBalanceRemoved,
            source: operation.source,
            balance: before.balanceId
        }
    ]
}

function __getSponsorshipEffect(action, type) {
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
            type: __getSponsorshipEffect(action, type),
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
                throw new Error(`Unsupported meta change type: ${type}`)
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

function empty() {
    return []
}

function adjustPrecision(value) {
    if (value === '0')
        return value
    return trimZeros(new Bignumber(value).div(10000000).toString())
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
        super(`Unexpected meta changes: ${change.action} ${change.type}`)
    }
}

module.exports = {analyzeOperationEffects, processFeeChargedEffect, effectTypes}