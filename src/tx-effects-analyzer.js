const Bignumber = require('bignumber.js')
const {parseLedgerEntryChanges} = require('./ledger-entry-changes-parser')
const {xdrParseAsset, xdrParseClaimantPredicate} = require('./tx-xdr-parser-utils')

function analyzeOperationEffects({operation, meta, result}) {
    //TODO: check that operation always has correct source account
    if (!operation.source)
        throw new Error('Aha')
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

function processFeeChargedEffect(tx, chargerAmount, feeBump = false) {
    const res = {
        type: 'feeCharged',
        source: tx.feeSource || tx.source,
        asset: 'XLM',
        feeBid: tx.fee,
        charged: chargerAmount

    }
    if (feeBump) {
        res.isFeeBump = true
    }
    return res
}

function processCreateAccountEffects({operation}) {
    const effect = {
        type: 'accountCreated',
        source: operation.source,
        account: operation.destination
    }
    if (parseFloat(operation.startingBalance) === 0)
        return [effect]
    return [
        effect,
        {
            type: 'accountDebited',
            source: operation.source,
            asset: 'XLM',
            amount: operation.startingBalance
        },
        {
            type: 'accountCredited',
            source: operation.destination,
            asset: 'XLM',
            amount: operation.startingBalance
        }
    ]
}

function processMergeAccountEffects({operation, result}) {
    const effect = {
        type: 'accountRemoved',
        account: operation.source
    }
    if (parseFloat(result.actualMergedAmount) === 0)
        return [effect]
    return [
        {
            type: 'accountDebited',
            source: operation.source,
            asset: 'XLM',
            amount: result.actualMergedAmount
        },
        {
            type: 'accountCredited',
            source: operation.destination,
            asset: 'XLM',
            amount: result.actualMergedAmount
        },
        effect
    ]
}

function processSetOptionsEffects({operation, changes}) {
    const effects = []
    const {before, after} = changes.find(ch => ch.type === 'account' && ch.before.address === operation.source)
    if (before.homeDomain !== after.homeDomain) {
        effects.push({
            type: 'accountHomeDomainUpdated',
            source: operation.source,
            domain: after.homeDomain
        })
    }
    if (JSON.stringify(before.thresholds) !== JSON.stringify(after.thresholds)) {
        effects.push({
            type: 'accountThresholdsUpdated',
            source: operation.source,
            thresholds: after.thresholds
        })
    }
    if (before.flags !== after.flags) {
        effects.push({
            type: 'accountFlagsUpdated',
            source: operation.source,
            flags: after.flags
        })
    }
    if (before.inflationDest !== after.inflationDest) {
        effects.push({
            type: 'accountInflationDestinationUpdated',
            source: operation.source,
            inflationDestination: after.inflationDest
        })
    }
    if (operation.masterWeight !== undefined && before.masterWeight !== after.masterWeight) {
        if (operation.masterWeight > 0) {
            effects.push({
                type: 'accountSignerUpdated',
                source: operation.source,
                signer: after.address,
                weight: after.masterWeight,
                masterWeight: after.masterWeight,
                signers: after.signers
            })
        } else {
            effects.push({
                type: 'accountSignerRemoved',
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
                type: 'accountSignerRemoved',
                source: operation.source,
                signer: key,
                weight: weight,
                masterWeight: after.masterWeight,
                signers: after.signers
            })
        } else if (before.signers.length < after.signers.length) {
            effects.push({
                type: 'accountSignerCreated',
                source: operation.source,
                signer: key,
                weight: weight,
                masterWeight: after.masterWeight,
                signers: after.signers
            })
        } else {
            effects.push({
                type: 'accountSignerUpdated',
                source: operation.source,
                signer: key,
                weight: weight,
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
        trustEffect.type = 'trustlineRemoved'
        if (trustChange.type === 'liquidityPoolStake' && changes.some(ch => ch.type === 'liquidityPool' && ch.action === 'removed')) {
            effects.push({
                type: 'liquidityPoolRemoved',
                source: operation.source,
                pool: trustedAsset
            })
        }
    } else {
        trustEffect.type = trustChange.action === 'created' ? 'trustlineCreated' : 'trustlineUpdated'
        trustEffect.limit = operation.limit
        if (trustChange.type === 'liquidityPoolStake') {
            const lpChange = changes.find(ch => ch.type === 'liquidityPool' && ch.action === 'created')
            if (lpChange) {
                effects.push({
                    type: 'liquidityPoolCreated',
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
            effectType = 'trustlineAuthorizationUpdated'
        } else {
            effectType = 'trustlineDeauthorized'
        }
    } else {
        switch (operation.authorize) {
            case false:
            case 0:
                effectType = 'trustlineDeauthorized'
                break
            case true:
            case 1:
            default:
                effectType = 'trustlineAuthorizationUpdated'
                break
        }
    }
    const {after} = changes[0]
    //const asset = `${operation.assetCode}-${operation.trustor}-${operation.assetCode.length > 4 ? 2 : 1}`
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
            type: 'accountDebited',
            source: operation.source,
            asset,
            amount: operation.amount
        },
        {
            type: 'accountCredited',
            source: operation.destination,
            asset,
            amount: operation.amount
        }
    ]
}

function processPathPaymentStrictReceiveEffects({operation, changes, result}) {
    if (!changes.length)
        return [] //self-transfer without effects
    const effects = processDexOperationEffects({operation, changes, result})
    const asset = xdrParseAsset(operation.destAsset)
    return [
        ...effects,
        {
            type: 'accountDebited',
            source: operation.source,
            asset,
            amount: operation.destAmount
        },
        {
            type: 'accountCredited',
            source: operation.destination,
            asset,
            amount: operation.destAmount
        }
    ]
}

function processPathPaymentStrictSendEffects({operation, changes, result}) {
    if (!changes.length)
        return [] //self-transfer without effects
    const effects = processDexOperationEffects({operation, changes, result})
    const asset = xdrParseAsset(operation.destAsset)
    return [
        ...effects,
        {
            type: 'accountDebited',
            source: operation.source,
            asset,
            amount: result.payment.amount
        },
        {
            type: 'accountCredited',
            source: operation.destination,
            asset,
            amount: result.payment.amount
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
                type: 'trade',
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
                    type: 'liquidityPoolUpdated',
                    source: operation.source,
                    amount: after.amount.map(adjustPrecision),
                    asset: after.asset,
                    price: new Bignumber(after.amount[0]).div(new Bignumber(after.amount[1])).toString(),
                    shares: after.shares,
                    accounts: after.accounts
                })
                break
            case 'offer':
                switch (action) {
                    case 'created': //new offer created as a result of manage offer operation
                        effects.push({
                            type: 'offerCreated',
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
                            type: 'offerUpdated',
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
                            type: 'offerRemoved',
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
    const effects = (result.inflationPayouts || []).map(ip => ({
        type: 'accountCredited',
        source: ip.account, asset: 'XLM',
        amount: adjustPrecision(ip.amount)
    }))
    return [
        {
            type: 'inflation',
            source: operation.source
        },
        ...effects
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
            effect.type = 'dataEntryCreated'
            effect.value = operation.value.toString('base64')
            break
        case 'updated':
            effect.type = 'dataEntryUpdated'
            effect.value = operation.value.toString('base64')
            break
        case 'removed':
            effect.type = 'dataEntryRemoved'
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
            type: 'sequenceBumped',
            source: operation.source,
            sequence: after.sequence
        }
    ]
}

function processCreateClaimableBalanceEffects({operation, result}) {
    const asset = xdrParseAsset(operation.asset)
    return [
        {
            type: 'accountDebited',
            source: operation.source,
            asset,
            amount: operation.amount
        },
        {
            type: 'claimableBalanceCreated',
            source: operation.source,
            balance: result.balanceId,
            asset,
            amount: operation.amount,
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
            type: 'accountCredited',
            source: operation.source,
            asset: before.asset,
            amount: adjustPrecision(before.amount)
        },
        {
            type: 'claimableBalanceRemoved',
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
                    type: 'liquidityPoolDeposited',
                    source: operation.source,
                    pool: operation.liquidityPoolId,
                    assets: after.asset.map((asset, i) => ({
                        asset,
                        amount: adjustPrecision(new Bignumber(after.amount[i]).minus(before.amount[i]))
                    })),
                    shares: new Bignumber(after.shares).minus(before.shares).toString()
                })
                effects.push({
                    type: 'liquidityPoolUpdated',
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
    for (let ch of changes) {
        if (ch.type !== 'liquidityPool')
            continue
        const {action, before, after} = ch
        switch (action) {
            case 'updated':
                effects.push({
                    type: 'liquidityPoolWithdrew',
                    source: operation.source,
                    pool: operation.liquidityPoolId,
                    assets: before.asset.map((asset, i) => ({
                        asset,
                        amount: adjustPrecision(new Bignumber(before.amount[i]).minus(after.amount[i]))
                    })),
                    shares: new Bignumber(before.shares).minus(after.shares).toString()
                })
                effects.push({
                    type: 'liquidityPoolUpdated',
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
            type: 'accountDebited',
            source: operation.from,
            asset,
            amount: operation.amount
        },
        {
            type: 'accountCredited',
            source: operation.source,
            asset,
            amount: operation.amount
        }
    ]
}

function processClawbackClaimableBalanceEffects({operation, changes}) {
    const {before} = changes.find(ch => ch.type === 'claimableBalance')
    return [
        {
            type: 'accountCredited',
            source: operation.source,
            asset: before.asset,
            amount: adjustPrecision(before.amount)
        },
        {
            type: 'claimableBalanceRemoved',
            source: operation.source,
            balance: before.balanceId
        }
    ]
}

function processSponsorshipEffects({operation, changes}) {
    for (let change of changes) {
        const {type, action, before, after} = change
        const effect = {
            type: 'Sponsorship',
            source: operation.source
        }
        switch (action) {
            case 'created':
                if (!after.sponsor)
                    continue
                effect.type += 'Created'
                effect.sponsor = after.sponsor
                break
            case 'updated':
                if (before.sponsor === after.sponsor)
                    continue
                effect.type += 'Updated'
                effect.sponsor = after.sponsor
                effect.prevSponsor = before.sponsor
                break
            case 'removed':
                if (!before.sponsor)
                    continue
                effect.type += 'Removed'
                effect.prevSponsor = before.sponsor
                break
        }
        switch (type) {
            case 'account':
                effect.type = 'account' + effect.type
                effect.account = before?.address || after?.address
                break
            case 'trustline':
                effect.type = 'trustline' + effect.type
                effect.account = before?.account || after?.account
                effect.asset = before?.asset || after?.asset
                break
            case 'liquidityPoolStake':
                effect.type = 'trustline' + effect.type
                effect.account = before?.account || after?.account
                effect.pool = before?.pool || after?.pool
                break
            case 'offer':
                effect.type = 'offer' + effect.type
                effect.account = before?.account || after?.account
                effect.offer = before?.id || after?.id
                break
            case 'data':
                effect.type = 'data' + effect.type
                effect.account = before?.account || after?.account
                effect.name = before?.name || after?.name
                break
            case 'claimableBalance':
                effect.type = 'claimableBalance' + effect.type
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
    for (let {type, action, before, after} of changes) {
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

        for (let signerKey of Object.keys(beforeMap)) {
            const newSponsor = afterMap[signerKey]
            if (!newSponsor) {
                operation.effects.push({
                    type: 'signerSponsorshipRemoved',
                    source: operation.source,
                    account: before.address,
                    signer: signerKey,
                    prevSponsor: beforeMap[signerKey]
                })
                break
            }
            if (newSponsor !== beforeMap[signerKey]) {
                operation.effects.push({
                    type: 'signerSponsorshipUpdated',
                    source: operation.source,
                    account: before.address,
                    signer: signerKey,
                    sponsor: newSponsor,
                    prevSponsor: beforeMap[signerKey]
                })
                break
            }
        }

        for (let signerKey of Object.keys(afterMap)) {
            const prevSponsor = beforeMap[signerKey]
            if (!prevSponsor) {
                operation.effects.push({
                    type: 'signerSponsorshipCreated',
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

class UnexpectedMetaChangeError extends Error {
    constructor(change) {
        super(`Unexpected meta changes: ${change.action} ${change.type}`)
    }
}


function adjustPrecision(value) {
    if (value === '0') return value
    return new Bignumber(value).div(10000000).toString()
}

module.exports = {analyzeOperationEffects, processFeeChargedEffect}