const {StrKey, Asset} = require('@stellar/stellar-base')
const {TxMetaEffectParserError} = require('../errors')

/**
 * @param {String} address
 * @return {String}
 */
function normalizeAddress(address) {
    const prefix = address[0]
    if (prefix === 'G')
        return address
    if (prefix !== 'M')
        throw new TypeError('Expected ED25519 or Muxed address')
    const rawBytes = StrKey.decodeMed25519PublicKey(address)
    return StrKey.encodeEd25519PublicKey(rawBytes.subarray(0, 32))
}


/**
 * @param {String} address
 * @return {Boolean}
 */
function isContractAddress(address) {
    return address.length === 56 && address[0] === 'C'
}

/**
 * @param {String} asset
 * @return {Asset}
 */
function toStellarAsset(asset) {
    if (asset === 'XLM')
        return Asset.native()
    if (asset.includes('-')) {
        const [code, issuer] = asset.split('-')
        return new Asset(code, issuer)
    }
    throw new TypeError('Unsupported asset format ' + asset)
}

/**
 * @param {String} amount
 * @param {Boolean} [throwIfInvalid]
 * @return {String|null}
 */
function validateAmount(amount, throwIfInvalid = true) {
    let parsed
    try {
        if (typeof amount !== 'string')
            throw new TypeError('Invalid amount type')
        parsed = BigInt(amount)
    } catch (e) {
        if (!throwIfInvalid)
            return null
        throw new TxMetaEffectParserError('Invalid amount: ' + amount)
    }
    if (parsed < 0n) {
        if (!throwIfInvalid)
            return null
        throw new TxMetaEffectParserError('Negative effect amount: ' + amount)
    }
    return amount
}

/**
 * @param largeInt
 * @return {String}
 */
function parseLargeInt(largeInt) {
    return largeInt._value.toString()
}

module.exports = {normalizeAddress, isContractAddress, toStellarAsset, validateAmount, parseLargeInt}