const {StrKey} = require('@stellar/stellar-sdk')
const {TxMetaEffectParserError} = require('../errors')
const {
    xdrParseAsset,
    xdrParseAccountAddress,
    xdrParseClaimant,
    xdrParsePrice,
    xdrParseSignerKey,
    xdrParseBytes,
    xdrParseHex,
    xdrParseBase64
} = require('./tx-xdr-parser-utils')
const {generateContractStateEntryHash, generateContractCodeEntryHash} = require('./ledger-key')

/**
 * @typedef {{}} ParsedLedgerEntryMeta
 * @property {'account'|'trustline'|'offer'|'data'|'liquidityPool'|'claimableBalance'|'contractData'|'contractCode'|'ttl'} type - Ledger entry type
 * @property {'created'|'updated'|'removed'|'restored'} action - Ledger modification action
 * @property {{}} before - Ledger entry state before changes applied
 * @property {{}} after - Ledger entry state after changes application
 */

/**
 * Retrieve the modification action encoded in the LedgerEntryChange union discriminant
 * @param {LedgerEntryChange} entry
 * @return {'created'|'updated'|'removed'|'state'|'restored'}
 */
function parseChangeAction(entry) {
    const {type} = entry //"ledgerEntryCreated", "ledgerEntryState", etc.
    if (!type.startsWith('ledgerEntry'))
        throw new TxMetaEffectParserError(`Unknown change entry type: ${type}`)
    const action = type.substring('ledgerEntry'.length)
    return action.charAt(0).toLowerCase() + action.substring(1)
}

/**
 * @param {LedgerEntryChange[]} ledgerEntryChanges
 * @param {Set<string>} [filter]
 * @return {ParsedLedgerEntryMeta[]}
 */
function parseLedgerEntryChanges(ledgerEntryChanges, filter = undefined) {
    const changes = []
    let state
    let containsTtl = false
    for (let i = 0; i < ledgerEntryChanges.length; i++) {
        const entry = ledgerEntryChanges[i]
        const action = parseChangeAction(entry)
        //"removed" changes carry a LedgerKey, all others carry a LedgerEntry
        const type = (action === 'removed' ? entry.value : entry.value.data).type
        if (filter && !filter.has(type)) //skip filtered ledger entry types
            continue
        const stateData = parseEntry(entry, action)
        if (stateData === undefined)
            continue
        const change = {action, type}
        switch (action) {
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
            case 'restored':
                change.before = stateData
                change.after = stateData
                change.type = stateData.entry
                state = change.after
                break
            case 'removed':
                change.before = state
                change.after = null
                change.type = state.entry
                break
            default:
                throw new TxMetaEffectParserError(`Unknown change entry type: ${action}`)
        }
        if (change.type === 'ttl') {
            containsTtl = true
        }
        changes.push(change)
    }
    if (containsTtl) { //put ttl entries into the end of array
        changes.sort((a, b) =>
            a.type !== 'ttl' && b.type === 'ttl' ?
                -1 : 0)
    }
    return changes
}

function parseEntry(entry, actionType) {
    if (actionType === 'removed')
        return null
    const value = entry.value
    const parsed = parseEntryData(value.data, actionType)
    if (parsed === null)
        return null
    //parsed.modified = entry.lastModifiedLedgerSeq
    return parseLedgerEntryExt(parsed, value)
}

function parseEntryData(data, actionType) {
    const updatedEntryType = data.type
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
            return parseContractCode(data, actionType)
        case 'ttl':
            return parseTtl(data)
        default:
            throw new TxMetaEffectParserError(`Unknown meta entry type: ${updatedEntryType}`)
    }
}

function parseLedgerEntryExt(data, entry) {
    const v1 = entry.ext?.v1
    if (v1) {
        const sponsor = v1.sponsoringId
        if (sponsor) {
            data.sponsor = xdrParseAccountAddress(sponsor)
        }
    }
    return data
}

function parseAccountEntry(value) {
    const accountEntryXdr = value.value
    const data = {
        entry: 'account',
        address: xdrParseAccountAddress(accountEntryXdr.accountId),
        sequence: accountEntryXdr.seqNum.toString(),
        balance: accountEntryXdr.balance.toString(),
        homeDomain: accountEntryXdr.homeDomain.toString(),
        inflationDest: xdrParseAccountAddress(accountEntryXdr.inflationDest),
        flags: accountEntryXdr.flags,
        signers: accountEntryXdr.signers.map(signer => ({
            key: xdrParseSignerKey(signer.key),
            weight: signer.weight
        }))
    }
    const thresholds = xdrParseBytes(accountEntryXdr.thresholds)
    data.thresholds = thresholds.slice(1).join()
    data.masterWeight = thresholds[0]
    const extV1 = accountEntryXdr.ext?.v1
    if (extV1) {
        const extV2 = extV1.ext?.v2
        if (extV2) {
            const sponsoringIDs = extV2.signerSponsoringIDs
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
    const trustlineEntryXdr = value.value
    const trustlineAsset = trustlineEntryXdr.asset
    const trustlineType = trustlineAsset.type
    let asset
    switch (trustlineType) {
        case 'assetTypeNative':
        case 'assetTypeCreditAlphanum4':
        case 'assetTypeCreditAlphanum12':
            asset = xdrParseAsset(trustlineAsset)
            break
        case 'assetTypePoolShare':
            asset = StrKey.encodeLiquidityPool(xdrParseBytes(trustlineAsset.liquidityPoolId))
            break
        default:
            throw new TxMetaEffectParserError(`Unsupported trustline type ` + trustlineType)
    }
    const data = {
        entry: 'trustline',
        account: xdrParseAccountAddress(trustlineEntryXdr.accountId),
        asset,
        balance: trustlineEntryXdr.balance.toString(),
        limit: trustlineEntryXdr.limit.toString(),
        flags: trustlineEntryXdr.flags
    }

    /*
    //ignored
    const extV1 = trustlineEntryXdr.ext?.v1
    if (extV1) {
        const liabilities = extV1.liabilities
        data.buying_liabilities = liabilities.buying.toString()
        data.selling_liabilities = liabilities.selling.toString()
    }*/

    return data
}

function parseDataEntry(value) {
    const dataEntryXdr = value.value
    return {
        entry: 'data',
        account: xdrParseAccountAddress(dataEntryXdr.accountId),
        name: dataEntryXdr.dataName.toString(),
        value: xdrParseBase64(dataEntryXdr.dataValue)
    }
}

function parseLiquidityPoolEntry(value) {
    const liquidityPoolEntryXdr = value.value
    const body = liquidityPoolEntryXdr.body.value
    const params = body.params
    return {
        entry: 'liquidityPool',
        pool: StrKey.encodeLiquidityPool(xdrParseBytes(liquidityPoolEntryXdr.liquidityPoolId)),
        asset: [xdrParseAsset(params.assetA), xdrParseAsset(params.assetB)],
        fee: params.fee,
        amount: [body.reserveA.toString(), body.reserveB.toString()],
        shares: body.totalPoolShares.toString(),
        accounts: Number(body.poolSharesTrustLineCount)
    }
}

function parseOfferEntry(value) {
    const offerEntryXdr = value.value
    const rprice = offerEntryXdr.price
    const data = {
        entry: 'offer',
        id: offerEntryXdr.offerId.toString(),
        account: xdrParseAccountAddress(offerEntryXdr.sellerId),
        asset: [xdrParseAsset(offerEntryXdr.selling), xdrParseAsset(offerEntryXdr.buying)],
        amount: offerEntryXdr.amount.toString(),
        price: xdrParsePrice(rprice),
        rprice: {n: rprice.n, d: rprice.d},
        flags: offerEntryXdr.flags
    }
    return data
}

function parseClaimableBalanceEntry(value) {
    const claimableBalanceXdr = value.value
    const data = {
        balanceId: StrKey.encodeClaimableBalance(xdrParseBytes(claimableBalanceXdr.balanceId.value)),
        entry: 'claimableBalance',
        asset: xdrParseAsset(claimableBalanceXdr.asset),
        amount: claimableBalanceXdr.amount.toString(),
        claimants: claimableBalanceXdr.claimants.map(claimant => xdrParseClaimant(claimant))
    }
    const extV1 = claimableBalanceXdr.ext?.v1
    if (extV1) {
        data.flags = extV1.flags
    }
    return data
}

function parseContractData(value) {
    const data = value.value
    const owner = parseStateOwnerDataAddress(data.contract)

    const valueAttr = data.val
    const entry = {
        entry: 'contractData',
        owner,
        key: data.key.toXdr('base64'),
        value: valueAttr.toXdr('base64'),
        durability: data.durability.name,
        keyHash: generateContractStateEntryHash(data)
    }
    if (data.key.type === 'scvLedgerKeyContractInstance' && entry.durability === 'persistent') {
        entry.durability = 'instance'
        const instance = valueAttr.instance
        const type = instance.executable.type
        switch (type) {
            case 'contractExecutableStellarAsset':
                if (instance.storage?.length) { //if not -- the asset has been created "fromAddress" - no metadata in this case
                    entry.kind = 'fromAsset'
                    const metaArgs = instance.storage[0]
                    if (metaArgs.key.value.toString() !== 'METADATA')
                        throw new TxMetaEffectParserError('Unexpected asset initialization metadata')
                    entry.asset = xdrParseAsset(metaArgs.val.map[1].val.value.toString())
                } else {
                    entry.kind = 'fromAddress'
                }
                break
            case 'contractExecutableWasm':
                entry.kind = 'wasm'
                entry.wasmHash = xdrParseHex(instance.executable.wasmHash)
                break
            default:
                throw new TxMetaEffectParserError('Unsupported executable type: ' + type)
        }
        if (instance.storage?.length) {
            entry.storage = instance.storage.map(entry => ({
                key: entry.key.toXdr('base64'),
                val: entry.val.toXdr('base64')
            }))
        }
    }
    return entry
}

function parseTtl(data) {
    const ttlEntry = data.value
    return {
        entry: 'ttl',
        keyHash: xdrParseHex(ttlEntry.keyHash),
        ttl: ttlEntry.liveUntilLedgerSeq
    }
}

function parseStateOwnerDataAddress(contract) {
    if (contract.type === 'scAddressTypeContract')
        return StrKey.encodeContract(xdrParseBytes(contract.contractId))
    return xdrParseAccountAddress(contract.accountId)
}

function parseContractCode(value, actionType) {
    const contract = value.value
    const hash = contract.hash
    const res = {
        entry: 'contractCode',
        hash: xdrParseHex(hash),
        keyHash: generateContractCodeEntryHash(hash)
    }
    if (actionType === 'created') {
        res.wasm = xdrParseBase64(contract.code)
    }
    return res
}

module.exports = {parseLedgerEntryChanges}
