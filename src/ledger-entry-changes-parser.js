const {
    xdrParseAsset,
    xdrParseAccountAddress,
    xdrParseClaimant,
    xdrParseLong,
    xdrParsePrice,
    xdrParseSignerKey
} = require('./tx-xdr-parser-utils')

/**
 * @typedef {{}} ParsedLedgerEntryMeta
 * @property {'account'|'trustline'|'liquidityPoolStake'|'offer'|'data'|'liquidityPool'|'claimableBalance'} type - Ledger entry type
 * @property {{}} before - Ledger entry state before changes applied
 * @property {{}} after - Ledger entry state after changes application
 */

/**
 * @param {LedgerEntryChange[]} ledgerEntryChanges
 * @return {ParsedLedgerEntryMeta[]}
 */
function parseLedgerEntryChanges(ledgerEntryChanges) {
    const changes = []
    let state
    for (let i = 0; i < ledgerEntryChanges.length; i++) {
        const entry = ledgerEntryChanges[i]
        const actionType = entry.arm()

        const stateData = parseEntry(entry.value(), actionType)
        const change = {action: actionType}
        switch (actionType) {
            case 'state':
                state = stateData
                continue
            case 'created':
                change.before = null
                change.after = stateData
                change.type = stateData.entry
                break
            case 'updated':
                change.before = state
                change.after = stateData
                change.type = stateData.entry
                break
            case 'removed':
                change.before = state
                change.after = null
                change.type = state.entry
                break
            default:
                throw new Error(`Unknown change entry type: ${actionType}`)
        }
        changes.push(change)
        state = null
    }
    return changes
}


function parseEntry(entry, actionType) {
    if (actionType === 'removed')
        return null //parseEntryData(entry)
    const parsed = parseEntryData(entry.data())
    parsed.modified = entry.lastModifiedLedgerSeq()
    return parseLedgerEntryExt(parsed, entry)
}

function parseEntryData(data) {
    const updatedEntryType = data.arm()
    switch (updatedEntryType) {
        case 'account':
            return parseAccountEntry(data)
        case 'trustline':
        case 'trustLine':
            return parseTrustlineEntry(data)
        case 'offer':
            return parseOfferEntry(data)
        case 'data':
        case 'datum':
            return parseDataEntry(data)
        case 'claimableBalance':
            return parseClaimableBalanceEntry(data)
        case 'liquidityPool':
            return parseLiquidityPoolEntry(data)
        default:
            throw new Error(`Unknown meta entry type: ${updatedEntryType}`)
    }
}

function parseLedgerEntryExt(data, entry) {
    const v1 = entry.ext()?.v1()
    if (v1) {
        const sponsor = v1.sponsoringId()
        if (sponsor) {
            data.sponsor = xdrParseAccountAddress(sponsor)
        }
    }
    return data
}

function parseAccountEntry(value) {
    const accountEntryXdr = value.value()
    const data = {
        entry: 'account',
        address: xdrParseAccountAddress(accountEntryXdr.accountId()),
        sequence: xdrParseLong(accountEntryXdr.seqNum()),
        balance: xdrParseLong(accountEntryXdr.balance()),
        numSubEntries: accountEntryXdr.numSubEntries(),
        homeDomain: accountEntryXdr.homeDomain().toString('UTF8'),
        inflationDest: xdrParseAccountAddress(accountEntryXdr.inflationDest()),
        flags: accountEntryXdr.flags(),
        signers: accountEntryXdr.signers().map(signer => ({
            key: xdrParseSignerKey(signer.key()),
            weight: signer.weight()
        }))
    }
    const thresholds = accountEntryXdr.thresholds()  //TODO: check if thresholds is a buffer
    data.thresholds = [
        thresholds[1],
        thresholds[2],
        thresholds[3]
    ]
    data.masterWeight = thresholds[0]
    const extV1 = accountEntryXdr.ext()?.v1()
    if (extV1) {
        const liabilities = extV1.liabilities()
        data.liabilities = [
            xdrParseLong(liabilities.buying()),
            xdrParseLong(liabilities.selling())
        ]
        const extV2 = extV1.ext()?.v2()
        if (extV2) {
            data.numSponsored = extV2.numSponsored()
            data.numSponsoring = extV2.numSponsoring()
            data.signerSponsoringIDs = extV2.signerSponsoringIDs().map(spid => xdrParseAccountAddress(spid))
        }
        const extV3 = extV2.ext()?.v3()
        if (extV3) {
            data.seqLedger = extV3.seqLedger()
            data.seqTime = xdrParseLong(extV3.seqTime())
        }
    }
    return data
}

function parseTrustlineEntry(value) {
    const trustlineEntryXdr = value.value()
    const trustlineAsset = trustlineEntryXdr.asset()
    const trustlineType = trustlineAsset.switch()
    const data = {
        account: xdrParseAccountAddress(trustlineEntryXdr.accountId()),
        balance: xdrParseLong(trustlineEntryXdr.balance()),
        limit: xdrParseLong(trustlineEntryXdr.limit()),
        flags: trustlineEntryXdr.flags()
    }

    switch (trustlineType.value) {
        case 0:
        case 1:
        case 2:
            data.asset = xdrParseAsset(trustlineAsset)
            data.entry = 'trustline'
            break
        case 3:
            data.pool = trustlineEntryXdr.asset().liquidityPoolId().toString('hex')
            data.entry = 'liquidityPoolStake'
            //data.liquidityPoolUseCount = trustlineEntryXdr.liquidityPoolUseCount()
            break
        default:
            throw new Error(`Unsupported trustline type ` + trustlineType)
    }
    const extV1 = trustlineEntryXdr.ext()?.v1()
    if (extV1) {
        data.buying_liabilities = xdrParseLong(extV1.buying())
        data.selling_liabilities = xdrParseLong(extV1.selling())
    }

    return data
}

function parseDataEntry(value) {
    const dataEntryXdr = value.value()
    return {
        entry: 'data',
        account: xdrParseAccountAddress(dataEntryXdr.accountId()),
        name: dataEntryXdr.dataName().toString(),
        value: dataEntryXdr.dataValue().toString('base64')
    }
}

function parseLiquidityPoolEntry(value) {
    const liquidityPoolEntryXdr = value.value()
    const body = liquidityPoolEntryXdr.body().value()
    const params = body.params()
    const data = {
        entry: 'liquidityPool',
        pool: liquidityPoolEntryXdr.liquidityPoolId().toString('hex'),
        asset: [xdrParseAsset(params.assetA()), xdrParseAsset(params.assetB())],
        fee: params.fee(),
        pool_type: 0,
        amount: [xdrParseLong(body.reserveA()), xdrParseLong(body.reserveB())],
        shares: xdrParseLong(body.totalPoolShares()),
        accounts: xdrParseLong(body.poolSharesTrustLineCount())
    }
    return data
}

function parseOfferEntry(value) {
    const offerEntryXdr = value.value()
    const data = {
        entry: 'offer',
        id: xdrParseLong(offerEntryXdr.offerId()),
        account: xdrParseAccountAddress(offerEntryXdr.sellerId()),
        asset: [xdrParseAsset(offerEntryXdr.selling()), xdrParseAsset(offerEntryXdr.buying())],
        amount: xdrParseLong(offerEntryXdr.amount()),
        price: xdrParsePrice(offerEntryXdr.price()),
        flags: offerEntryXdr.flags()
    }
    return data
}

function parseClaimableBalanceEntry(value) {
    const claimableBalanceXdr = value.value()
    const data = {
        balanceId: Buffer.from(claimableBalanceXdr.balanceId().value()).toString('hex'),
        entry: 'claimableBalance',
        asset: xdrParseAsset(claimableBalanceXdr.asset()),
        amount: xdrParseLong(claimableBalanceXdr.amount()),
        claimants: claimableBalanceXdr.claimants().map(claimant => xdrParseClaimant(claimant))
    }
    const extV1 = claimableBalanceXdr.ext()?.v1()
    if (extV1) {
        data.flags = extV1.flags()
    }
    return data
}

module.exports = {parseLedgerEntryChanges}