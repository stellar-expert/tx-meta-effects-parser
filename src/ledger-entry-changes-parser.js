const {StrKey} = require('@stellar/stellar-base')
const {
    xdrParseAsset,
    xdrParseAccountAddress,
    xdrParseClaimant,
    xdrParsePrice,
    xdrParseSignerKey,
    xdrParseScVal
} = require('./tx-xdr-parser-utils')
const {TxMetaEffectParserError} = require('./errors')

/**
 * @typedef {{}} ParsedLedgerEntryMeta
 * @property {'account'|'trustline'|'offer'|'data'|'liquidityPool'|'claimableBalance'|'contractData'|'contractCode'} type - Ledger entry type
 * @property {'created'|'updated'|'removed'} action - Ledger modification action
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
        if (stateData === undefined)
            continue
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
                if (!state && entry._value._arm === 'ttl')
                    continue //skip expiration processing for now
                change.before = state
                change.after = null
                change.type = state.entry
                break
            default:
                throw new TxMetaEffectParserError(`Unknown change entry type: ${actionType}`)
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
    if (parsed === null)
        return null
    //parsed.modified = entry.lastModifiedLedgerSeq()
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
        case 'contractData':
            return parseContractData(data)
        case 'contractCode':
            return undefined
        case 'ttl':
            return undefined
        default:
            throw new TxMetaEffectParserError(`Unknown meta entry type: ${updatedEntryType}`)
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
        homeDomain: accountEntryXdr.homeDomain().toString('UTF8'),
        inflationDest: xdrParseAccountAddress(accountEntryXdr.inflationDest()),
        flags: accountEntryXdr.flags(),
        signers: accountEntryXdr.signers().map(signer => ({
            key: xdrParseSignerKey(signer.key()),
            weight: signer.weight()
        }))
    }
    const thresholds = accountEntryXdr.thresholds()
    data.thresholds = thresholds.slice(1).join()
    data.masterWeight = thresholds[0]
    const extV1 = accountEntryXdr.ext()?.v1()
    if (extV1) {
        const extV2 = extV1.ext()?.v2()
        if (extV2) {
            const sponsoringIDs = extV2.signerSponsoringIDs()
            if (sponsoringIDs.length > 0) {
                for (let i = 0; i < data.signers.length; i++) {
                    const sponsor = sponsoringIDs[i]
                    if (sponsor) { //attach sponsors directly to the signers
                        data.signers[i].sponsor = xdrParseAccountAddress(sponsor)
                    }
                }
            }
        }
    }
    //ignored fields: numSubEntries, extV1.liabilities, extV2.numSponsored, extV2.numSponsoring, extV3.seqLedger, extv3.seqTime
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
            throw new TxMetaEffectParserError(`Unsupported trustline type ` + trustlineType)
    }
    const data = {
        entry: 'trustline',
        account: xdrParseAccountAddress(trustlineEntryXdr.accountId()),
        asset,
        balance: trustlineEntryXdr.balance().toString(),
        limit: trustlineEntryXdr.limit().toString(),
        flags: trustlineEntryXdr.flags()
    }

    /*
    //ignored
    const extV1 = trustlineEntryXdr.ext()?.v1()
    if (extV1) {
        const liabilities = extV1.liabilities()
        data.buying_liabilities = liabilities.buying().toString()
        data.selling_liabilities = liabilities.selling().toString()
    }*/

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

function parseContractData(value) {
    const data = value.value()
    const owner = parseStateOwnerDataAddress(data.contract())

    const valueAttr = data.val()
    switch (data.key().switch()?.name) {
        case 'scvLedgerKeyContractInstance':
            const entry = {
                entry: 'contract',
                contract: owner
            }
            const type = valueAttr.instance().executable().switch().name
            switch (type) {
                case 'contractExecutableStellarAsset':
                    entry.type = 'token'
                    /**
                     * data._attributes.val._value._attributes.storage
                     *
                     * ScVal: [scvContractInstance]
                     * instance
                     * executable: [contractExecutableStellarAsset]
                     * storage: Array[3]
                     * [0]
                     * key: [scvSymbol]
                     * sym: METADATA
                     * val: [scvMap]
                     * map: Array[3]
                     * [0]
                     * key: [scvSymbol]
                     * sym: decimal
                     * val: [scvU32]
                     * u32: 7
                     * [1]
                     * key: [scvSymbol]
                     * sym: name
                     * val: [scvString]
                     * str: ICGVCWUQXIHO:GBD2ALDOSNTEW2QWQA6RGQXTZVWGFZYTT5DYZDCPPGNOYTXOAQ6RFUAC
                     * [2]
                     * key: [scvSymbol]
                     * sym: symbol
                     * val: [scvString]
                     * str: ICGVCWUQXIHO
                     * [1]
                     * key: [scvVec]
                     * vec: Array[1]
                     * [0]: [scvSymbol]
                     * sym: Admin
                     * val: [scvAddress]
                     * address: [scAddressTypeAccount]
                     * accountId: [publicKeyTypeEd25519]
                     * ed25519: GBD2ALDOSNTEW2QWQA6RGQXTZVWGFZYTT5DYZDCPPGNOYTXOAQ6RFUAC
                     */
                    return undefined
                    break
                case 'contractExecutableWasm':
                    entry.kind = 'wasm'
                    entry.hash = valueAttr.instance().executable().wasmHash().toString('hex')
                    break
                default:
                    throw new TxMetaEffectParserError('Unsupported executable type: ' + type)
            }
            return entry
    }

    return {
        entry: 'contractData',
        owner,
        key: data.key().toXDR('base64'),
        value: valueAttr.toXDR('base64'),
        durability: data.durability().name
    }
}

function parseStateOwnerDataAddress(contract) {
    if (contract.switch().name === 'scAddressTypeContract')
        return StrKey.encodeContract(contract.contractId())
    return xdrParseAccountAddress(contract.accountId())
}

/*function parseContractCode(value) {
    const contract = value.value()
    return {
        entry: 'contractCode',
        hash: contract.hash().toString('hex'),
        code: contract.body().code().toString('base64')
    }
}*/

module.exports = {parseLedgerEntryChanges}