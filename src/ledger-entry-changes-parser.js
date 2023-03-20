const {
    xdrParseAsset,
    xdrParseAccountAddress,
    xdrParseClaimant,
    xdrParsePrice,
    xdrParseSignerKey
} = require('./tx-xdr-parser-utils')

/**
 * @typedef {{}} ParsedLedgerEntryMeta
 * @property {'account'|'trustline'|'offer'|'data'|'liquidityPool'|'claimableBalance'} type - Ledger entry type
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
        sequence: accountEntryXdr.seqNum().toString(),
        balance: accountEntryXdr.balance().toString(),
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
            liabilities.buying().toString(),
            liabilities.selling().toString()
        ]
        const extV2 = extV1.ext()?.v2()
        if (extV2) {
            data.numSponsored = extV2.numSponsored()
            data.numSponsoring = extV2.numSponsoring()
            data.signerSponsoringIDs = extV2.signerSponsoringIDs().map(spid => xdrParseAccountAddress(spid))
            const extV3 = extV2.ext()?.v3()
            if (extV3) {
                data.seqLedger = extV3.seqLedger()
                data.seqTime = extV3.seqTime().toString()
            }
        }
    }
    return data
}

function parseTrustlineEntry(value) {
    const trustlineEntryXdr = value.value()
    const trustlineAsset = trustlineEntryXdr.asset()
    const trustlineType = trustlineAsset.switch()
    let asset
    switch (trustlineType.value) {
        case 0:
        case 1:
        case 2:
            asset = xdrParseAsset(trustlineAsset)
            break
        case 3:
            asset = trustlineEntryXdr.asset().liquidityPoolId().toString('hex')
            //data.liquidityPoolUseCount = trustlineEntryXdr.liquidityPoolUseCount()
            break
        default:
            throw new Error(`Unsupported trustline type ` + trustlineType)
    }
    const data = {
        entry: 'trustline',
        account: xdrParseAccountAddress(trustlineEntryXdr.accountId()),
        asset,
        balance: trustlineEntryXdr.balance().toString(),
        limit: trustlineEntryXdr.limit().toString(),
        flags: trustlineEntryXdr.flags()
    }


    const extV1 = trustlineEntryXdr.ext()?.v1()
    if (extV1) {
        const liabilities = extV1.liabilities()
        data.buying_liabilities = liabilities.buying().toString()
        data.selling_liabilities = liabilities.selling().toString()
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
    return {
        entry: 'liquidityPool',
        pool: liquidityPoolEntryXdr.liquidityPoolId().toString('hex'),
        asset: [xdrParseAsset(params.assetA()), xdrParseAsset(params.assetB())],
        fee: params.fee(),
        pool_type: 0,
        amount: [body.reserveA().toString(), body.reserveB().toString()],
        shares: body.totalPoolShares().toString(),
        accounts: body.poolSharesTrustLineCount().low
    }
}

function parseOfferEntry(value) {
    const offerEntryXdr = value.value()
    const data = {
        entry: 'offer',
        id: offerEntryXdr.offerId().toString(),
        account: xdrParseAccountAddress(offerEntryXdr.sellerId()),
        asset: [xdrParseAsset(offerEntryXdr.selling()), xdrParseAsset(offerEntryXdr.buying())],
        amount: offerEntryXdr.amount().toString(),
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
        amount: claimableBalanceXdr.amount().toString(),
        claimants: claimableBalanceXdr.claimants().map(claimant => xdrParseClaimant(claimant))
    }
    const extV1 = claimableBalanceXdr.ext()?.v1()
    if (extV1) {
        data.flags = extV1.flags()
    }
    return data
}

module.exports = {parseLedgerEntryChanges}