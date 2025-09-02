const {StrKey} = require('@stellar/stellar-base')
const {TxMetaEffectParserError, UnexpectedTxMetaChangeError} = require('../errors')
const {xdrParseAsset, xdrParseAccountAddress, xdrParseClaimant, xdrParsePrice, xdrParseSignerKey} = require('./tx-xdr-parser-utils')
const {generateContractStateEntryHash, generateContractCodeEntryHash} = require('./ledger-key')

/**
 * @typedef {{}} ParsedLedgerEntryMeta
 * @property {'account'|'trustline'|'offer'|'data'|'liquidityPool'|'claimableBalance'|'contractData'|'contractCode'|'ttl'} type - Ledger entry type
 * @property {'created'|'updated'|'removed'|'restored'} action - Ledger modification action
 * @property {{}} before - Ledger entry state before changes applied
 * @property {{}} after - Ledger entry state after changes application
 */

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
        const type = entry._value._arm
        if (filter && !filter.has(type)) //skip filtered ledger entry types
            continue
        const action = entry._arm
        const stateData = parseEntry(entry, action)
        if (stateData === undefined)
            continue
        const change = {action, type}
        switch (action) {
            case 'state':
                state = stateData
                continue
            case 'created':
                if (type === 'contractCode')
                    continue //processed in operation handler
                change.before = null
                change.after = stateData
                change.type = stateData.entry
                break
            case 'updated':
                if (type === 'contractCode')
                    throw new UnexpectedTxMetaChangeError({type, action})
                if (!state && stateData.keyHash) { //likely, restored state
                    const restored = changes.find(ch => ch.action === 'restored' && ch.type === stateData.entry && ch.after.keyHash === stateData.keyHash)
                    state = restored?.after
                }
                change.before = state
                change.after = stateData
                change.type = stateData.entry
                break
            case 'restored':
                change.before = stateData
                change.after = stateData
                change.type = stateData.entry
                break
            case 'removed':
                if (!state && type === 'ttl')
                    continue //skip expiration processing for now
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
        state = null
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
    const value = entry.value()
    const parsed = parseEntryData(value.data())
    if (parsed === null)
        return null
    //parsed.modified = entry.lastModifiedLedgerSeq()
    return parseLedgerEntryExt(parsed, value)
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
            return parseContractCode(data)
        case 'ttl':
            return parseTtl(data)
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
    const entry = {
        entry: 'contractData',
        owner,
        key: data.key().toXDR('base64'),
        value: valueAttr.toXDR('base64'),
        durability: data.durability().name,
        keyHash: generateContractStateEntryHash(data)
    }
    if (data.key().switch()?.name === 'scvLedgerKeyContractInstance' && entry.durability === 'persistent') {
        entry.durability = 'instance'
        const instance = valueAttr.instance()._attributes
        const type = instance.executable._switch.name
        switch (type) {
            case 'contractExecutableStellarAsset':
                entry.kind = 'fromAsset'
                if (instance.storage?.length) { //if not -- the asset has been created "fromAddress" - no metadata in this case
                    const metaArgs = instance.storage[0]._attributes
                    if (metaArgs.key._value.toString() !== 'METADATA')
                        throw new TxMetaEffectParserError('Unexpected asset initialization metadata')
                    entry.asset = xdrParseAsset(metaArgs.val._value[1]._attributes.val._value.toString())
                }
                break
            case 'contractExecutableWasm':
                entry.kind = 'wasm'
                entry.wasmHash = instance.executable.wasmHash().toString('hex')
                break
            default:
                throw new TxMetaEffectParserError('Unsupported executable type: ' + type)
        }
        if (instance.storage?.length) {
            entry.storage = instance.storage.map(entry => ({
                key: entry.key().toXDR('base64'),
                val: entry.val().toXDR('base64')
            }))
        }
    }
    return entry
}

function parseTtl(data) {
    const attrs = data._value._attributes
    return {
        entry: 'ttl',
        keyHash: attrs.keyHash.toString('hex'),
        ttl: attrs.liveUntilLedgerSeq
    }
}

function parseStateOwnerDataAddress(contract) {
    if (contract.switch().name === 'scAddressTypeContract')
        return StrKey.encodeContract(contract.contractId())
    return xdrParseAccountAddress(contract.accountId())
}

function parseContractCode(value) {
    const contract = value.value()
    const hash = contract.hash()
    return {
        entry: 'contractCode',
        hash: hash.toString('hex'),
        keyHash: generateContractCodeEntryHash(hash)
    }
}

module.exports = {parseLedgerEntryChanges}