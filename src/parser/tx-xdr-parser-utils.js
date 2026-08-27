const {
    xdr,
    StrKey,
    LiquidityPoolId,
    scValToBigInt,
    encodeMuxedAccount,
    encodeMuxedAccountToAddress
} = require('@stellar/stellar-sdk')
const {TxMetaEffectParserError} = require('../errors')
const effectTypes = require('../effect-types')

/**
 * Unwrap raw bytes from an XDR value wrapper (Hash, ContractId, PoolId, AssetCode4, etc.)
 * @param {Uint8Array|{value: Uint8Array}} value
 * @return {Uint8Array}
 */
function xdrParseBytes(value) {
    if (value instanceof Uint8Array)
        return value
    if (value?.value instanceof Uint8Array)
        return value.value
    throw new TypeError(`Failed to retrieve raw bytes from the value: ${value}`)
}

/**
 * Encode raw XDR bytes as a hex string
 * @param {Uint8Array|{value: Uint8Array}} value
 * @return {String}
 */
function xdrParseHex(value) {
    return xdr.encodeBytes(xdrParseBytes(value), 'hex')
}

/**
 * Encode raw XDR bytes as a base64 string
 * @param {Uint8Array|{value: Uint8Array}} value
 * @return {String}
 */
function xdrParseBase64(value) {
    return xdr.encodeBytes(xdrParseBytes(value), 'base64')
}

/**
 * Decode XDR opaque value bytes as an UTF8 string
 * @param {Uint8Array|{value: Uint8Array}} value
 * @return {String}
 */
function xdrParseText(value) {
    return new TextDecoder().decode(xdrParseBytes(value))
}

/**
 * Parse account address from XDR representation
 * @param accountId
 * @return {String}
 */
function xdrParseAccountAddress(accountId) {
    if (!accountId)
        return undefined
    switch (accountId.type) {
        case 'publicKeyTypeEd25519':
        case 'keyTypeEd25519':
            return StrKey.encodeEd25519PublicKey(xdrParseBytes(accountId.ed25519))
        case 'keyTypeMuxedEd25519':
            return {
                primary: StrKey.encodeEd25519PublicKey(xdrParseBytes(accountId.value.ed25519)),
                muxedId: accountId.value.id.toString()
            }
    }
    if (typeof accountId.type === 'string')
        throw new TxMetaEffectParserError(`Unsupported account type: ${accountId.type}`)
    if (accountId instanceof Uint8Array || accountId.value instanceof Uint8Array)
        return StrKey.encodeEd25519PublicKey(xdrParseBytes(accountId))
    throw new TypeError(`Failed to identify and parse account address: ${accountId}`)
}

/**
 * Parse muxed account address from ScAddress XDR representation
 * @param {{}} value
 * @return {string}
 */
function xdrParseMuxedScAddress(value) {
    const muxed = encodeMuxedAccount(StrKey.encodeEd25519PublicKey(xdrParseBytes(value.ed25519)), value.id.toString())
    return encodeMuxedAccountToAddress(muxed)
}

/**
 * Parse Contract ID from raw bytes
 * @param {Uint8Array|{value: Uint8Array}} rawContractId
 * @return {String}
 */
function xdrParseContractAddress(rawContractId) {
    return StrKey.encodeContract(xdrParseBytes(rawContractId))
}

/**
 * Parse ScAddress XDR representation
 * @param {xdr.ScAddress} address
 * @return {String}
 */
function xdrParseScAddress(address) {
    switch (address.type) {
        case 'scAddressTypeAccount':
            return xdrParseAccountAddress(address.accountId)
        case 'scAddressTypeContract':
            return xdrParseContractAddress(address.contractId)
        case 'scAddressTypeMuxedAccount':
            return xdrParseMuxedScAddress(address.muxedAccount)
        case 'scAddressTypeLiquidityPool':
            return StrKey.encodeLiquidityPool(xdrParseBytes(address.liquidityPoolId))
        case 'scAddressTypeClaimableBalance':
            return StrKey.encodeClaimableBalance(xdrParseBytes(address.claimableBalanceId.value))
    }
    throw new TxMetaEffectParserError('Not supported XDR primitive type: ' + address.type)
}

/**
 * Parse XDR price representation
 * @param {{n: Number, d: Number}} price
 * @return {Number}
 */
function xdrParsePrice(price) {
    return price.n / price.d
}

/**
 * @param {string} address
 * @return {string}
 */
function retrieveBaseMuxedAddress(address) {
    const rawBytes = StrKey.decodeMed25519PublicKey(address)
    return StrKey.encodeEd25519PublicKey(rawBytes.subarray(0, 32))
}

/**
 * Parse account signer key XDR
 * @param {xdr.SignerKey} signer
 * @return {String}
 */
function xdrParseSignerKey(signer) {
    const type = signer.type
    switch (type) {
        case 'signerKeyTypeEd25519':
            return StrKey.encodeEd25519PublicKey(xdrParseBytes(signer.ed25519))
        case 'signerKeyTypePreAuthTx':
            return StrKey.encodePreAuthTx(xdrParseBytes(signer.preAuthTx))
        case 'signerKeyTypeHashX':
            return StrKey.encodeSha256Hash(xdrParseBytes(signer.hashX))
        case 'signerKeyTypeEd25519SignedPayload':
            return StrKey.encodeSignedPayload(xdrParseBytes(signer.ed25519SignedPayload.ed25519)) //TODO: check
    }
    throw new TxMetaEffectParserError(`Unsupported signer type: "${type}"`)
}


/**
 * @typedef {Object} ParsedOffer
 * @property {String} account
 * @property {Array<String>} asset
 * @property {Array<String>} amount
 * @property {String} offerId?
 * @property {Uint8Array} poolId?
 */

/**
 * Parse maker offer descriptor from raw XDR.
 * @param {Object} offerXdr
 * @return {ParsedOffer}
 */
function xdrParseTradeAtom(offerXdr) {
    return {
        offerId: offerXdr.offerId.toString(),
        account: xdrParseAccountAddress(offerXdr.sellerId),
        asset: [xdrParseAsset(offerXdr.selling).toString(), xdrParseAsset(offerXdr.buying).toString()],
        //offer amount is always stored in terms of a selling asset, even for buy offers
        amount: (offerXdr.amount ?? offerXdr.buyAmount).toString(),
        //flags: offerXdr.flags
        price: xdrParsePrice(offerXdr.price)
    }
}

/**
 * Parse claimed offer atom from raw XDR.
 * @param {xdr.ClaimAtom} claimedAtom
 * @return {ParsedOffer}
 */
function xdrParseClaimedOffer(claimedAtom) {
    const atomType = claimedAtom.type
    let res
    switch (atomType) {
        case 'claimAtomTypeV0':
            claimedAtom = claimedAtom.v0
            res = {
                account: xdrParseAccountAddress(claimedAtom.sellerEd25519),
                offerId: claimedAtom.offerId.toString()
            }
            break
        case 'claimAtomTypeOrderBook':
            claimedAtom = claimedAtom.orderBook
            res = {
                account: xdrParseAccountAddress(claimedAtom.sellerId),
                offerId: claimedAtom.offerId.toString()
            }
            break
        case 'claimAtomTypeLiquidityPool':
            claimedAtom = claimedAtom.liquidityPool
            res = {
                poolId: xdrParseBytes(claimedAtom.liquidityPoolId)
            }
            break
        default:
            throw new TxMetaEffectParserError(`Unsupported claimed atom type: ` + atomType)
    }
    return {
        asset: [
            xdrParseAsset(claimedAtom.assetSold),
            xdrParseAsset(claimedAtom.assetBought)
        ],
        amount: [
            claimedAtom.amountSold.toString(),
            claimedAtom.amountBought.toString()
        ],
        ...res
    }
}

function xdrParseClaimantPredicate(predicate) {
    if (!predicate) return {}
    const type = predicate.type
    const value = predicate.value
    switch (type) {
        case 'claimPredicateUnconditional':
            return {}
        case 'claimPredicateAnd':
            return {and: value.map(p => xdrParseClaimantPredicate(p))}
        case 'claimPredicateOr':
            return {or: value.map(p => xdrParseClaimantPredicate(p))}
        case 'claimPredicateNot':
            return {not: xdrParseClaimantPredicate(value)}
        case 'claimPredicateBeforeAbsoluteTime':
            return {absBefore: value.toString()}
        case 'claimPredicateBeforeRelativeTime':
            return {relBefore: value.toString()}
        default:
            throw new TxMetaEffectParserError(`Unknown claim condition predicate: ${type}`)
    }
}

function xdrParseClaimant(claimant) {
    const value = claimant.value
    return {
        destination: xdrParseAccountAddress(value.destination),
        predicate: xdrParseClaimantPredicate(value.predicate)
    }
}

function xdrParseAsset(src) {
    if (!src)
        return undefined

    if (typeof src.type === 'string') { //XDR
        switch (src.type) {
            case 'assetTypeNative':
                return 'XLM'
            case 'assetTypePoolShare': {
                const poolId = src.value
                if (poolId instanceof Uint8Array || poolId?.value instanceof Uint8Array)
                    return xdrParseHex(poolId)
                if (poolId.constantProduct)
                    return LiquidityPoolId.fromOperation(poolId).getLiquidityPoolId()
                throw new TxMetaEffectParserError('Unsupported liquidity pool asset id format')
            }
            default: {
                const value = src.value
                return `${xdrParseText(value.assetCode).replace(/\0+$/, '')}-${xdrParseAccountAddress(value.issuer)}-${src.type === 'assetTypeCreditAlphanum4' ? 1 : 2}`
            }
        }
    }

    if (typeof src === 'string') {
        if (src === 'XLM' || src === 'native')
            return 'XLM'//already parsed value
        if (src.includes(':')) {
            const [code, issuer] = src.split(':')
            return `${code.replace(/\0+$/, '')}-${issuer}-${code.length > 4 ? 2 : 1}`
        }
        if (src.includes('-'))
            return src //already parsed
        if (src.length === 64)
            return src //pool id
    }
    if (src.type === 0 && !src.code || src.code === 'XLM' && !src.issuer)
        return 'XLM'
    if (src.code && src.issuer)
        return `${src.code}-${src.issuer}-${src.type || (src.code.length > 4 ? 2 : 1)}`
}

function xdrParseScVal(value, treatBytesAsContractId = false) {
    if (typeof value === 'string') {
        value = xdr.ScVal.fromXdr(value, 'base64')
    }
    switch (value.type) {
        case 'scvVec':
            return value.vec.map(xdrParseScVal)
        case 'scvMap':
            const res = {}
            for (const entry of value.map) {
                res[xdrParseScVal(entry.key)] = xdrParseScVal(entry.val)
            }
            return res
        case 'scvI256':
        case 'scvU256':
        case 'scvI128':
        case 'scvU128':
        case 'scvI64':
        case 'scvU64':
            return scValToBigInt(value).toString()
        case 'scvTimepoint':
        case 'scvDuration':
            return value.value.toString()
        case 'scvAddress':
            return xdrParseScAddress(value.address)
        case 'scvBytes':
            return treatBytesAsContractId ? xdrParseContractAddress(value.bytes) : xdrParseBase64(value.bytes)
        case 'scvI32':
        case 'scvU32':
        case 'scvBool':
            return value.value
        case 'scvString':
        case 'scvSymbol':
            return value.value.toString()
        case 'scvLedgerKeyNonce':
            return value.nonceKey.nonce.toString()
        case 'scvContractInstance':
            return xdrParseBase64(value.instance.executable.wasmHash)
        case 'scvError':
            return value.toXdr('base64')
        case 'scvVoid':
            return undefined
        case 'scvLedgerKeyContractInstance':
            return '<LedgerKeyContractInstance>'
        //xdrParseScVal is also invoked with bare ScAddress values (e.g. InvokeContractArgs.contractAddress)
        case 'scAddressTypeAccount':
        case 'scAddressTypeContract':
        case 'scAddressTypeMuxedAccount':
        case 'scAddressTypeLiquidityPool':
        case 'scAddressTypeClaimableBalance':
            return xdrParseScAddress(value)
        default:
            throw new TxMetaEffectParserError('Not supported XDR primitive type: ' + (value.toXdr ? value.toXdr('base64') : value.toString()))
    }
}

function xdrParseSacBalanceChange(changeEventType, key, value) {
    const parsedKey = xdr.ScVal.fromXdr(key, 'base64')
    if (parsedKey.type !== 'scvVec')
        return null
    const keyParts = parsedKey.vec
    if (!(keyParts instanceof Array) || keyParts.length !== 2)
        return null
    if (keyParts[0].type !== 'scvSymbol' || keyParts[1].type !== 'scvAddress' || keyParts[0].value.toString() !== 'Balance')
        return null
    const res = {
        address: xdrParseScVal(keyParts[1]),
        balance: changeEventType === effectTypes.contractDataRemoved ?
            '0' :
            retrieveBalanceFromStateData(value)
    }
    if (res.balance === undefined)
        return null
    return res
}

function retrieveBalanceFromStateData(value) {
    const xdrVal = xdr.ScVal.fromXdr(value, 'base64')
    if (xdrVal.type !== 'scvMap')
        return undefined
    const parsedValue = xdrParseScVal(xdrVal)
    if (typeof parsedValue.amount !== 'string')
        return undefined
    return parsedValue.amount
}

module.exports = {
    xdrParseAsset,
    xdrParseAccountAddress,
    xdrParseContractAddress,
    xdrParseMuxedScAddress,
    xdrParseScAddress,
    xdrParseClaimant,
    xdrParseClaimedOffer,
    xdrParseTradeAtom,
    xdrParseSignerKey,
    xdrParsePrice,
    xdrParseScVal,
    xdrParseSacBalanceChange,
    xdrParseBytes,
    xdrParseHex,
    xdrParseBase64,
    xdrParseText,
    retrieveBaseMuxedAddress
}
