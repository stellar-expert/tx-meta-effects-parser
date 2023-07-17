const {StrKey} = require('stellar-base')
const effectTypes = require('./effect-types')
const {UnexpectedTxMetaChangeError} = require('./errors')

/**
 * Calculate difference between two amounts
 * @param {String} before
 * @param {String} after
 * @return {String}
 */
function diff(before, after) {
    return (BigInt(before) - BigInt(after)).toString()
}

/**
 * Returns true for AlphaNum4/12 assets adn false otherwise
 * @param {String} asset
 */
function isAsset(asset) {
    return asset.includes('-') //lazy check for {code}-{issuer}-{type} format
}


/**
 * Convert value in stroops (Int64 amount) to the normal string representation
 * @param {String|Number|BigInt} valueInStroops
 * @return {String}
 */
function fromStroops(valueInStroops) {
    try {
        let parsed = typeof valueInStroops === 'bigint' ?
            valueInStroops :
            BigInt(valueInStroops.toString())
        let negative = false
        if (parsed < 0n) {
            negative = true
            parsed *= -1n
        }
        const int = parsed / 10000000n
        const fract = parsed % 10000000n
        let res = int.toString()
        if (fract) {
            res += '.' + fract.toString().padStart(7, '0')
        }
        if (negative) {
            res = '-' + res
        }
        return trimZeros(res)
    } catch (e) {
        return '0'
    }
}


/**
 * Convert arbitrary stringified amount to int64 representation
 * @param {String|Number} value
 * @return {BigInt}
 */
function toStroops(value) {
    if (!value)
        return 0n
    if (typeof value === 'number') {
        value = value.toFixed(7)
    }
    if (typeof value !== 'string' || !/^-?[\d.,]+$/.test(value))
        return 0n //invalid format
    try {
        let [int, decimal = '0'] = value.split('.', 2)
        let negative = false
        if (int.startsWith('-')) {
            negative = true
            int = int.slice(1)
        }
        let res = BigInt(int) * 10000000n + BigInt(decimal.slice(0, 7).padEnd(7, '0'))
        if (negative) {
            res *= -1n
            if (res < -0x8000000000000000n) //overflow
                return 0n
        } else if (res > 0xFFFFFFFFFFFFFFFFn) //overflow
            return 0n
        return res
    } catch (e) {
        return 0n
    }
}

/**
 * Trim trailing fractional zeros from a string amount representation
 * @param {String} value
 * @return {String}
 * @internal
 */
function trimZeros(value) {
    const [int, fract] = value.split('.')
    if (!fract)
        return int
    const trimmed = fract.replace(/0+$/, '')
    if (!trimmed.length)
        return int
    return int + '.' + trimmed
}

/**
 * Replace multiplexed addresses with base G addresses
 * @param {String} address
 * @return {String}
 * @internal
 */
function normalizeAddress(address) {
    const prefix = address[0]
    if (prefix === 'G')
        return address //lazy check for ed25519 G address
    if (prefix !== 'M')
        throw new TypeError('Expected ED25519 or Muxed address')
    const rawBytes = StrKey.decodeMed25519PublicKey(address)
    return StrKey.encodeEd25519PublicKey(rawBytes.subarray(0, 32))
}

/**
 * @param {String} action
 * @param {String} type
 * @return {String}
 */
function encodeSponsorshipEffectName(action, type) {
    let actionKey
    switch (action) {
        case 'created':
            actionKey = 'Created'
            break
        case 'updated':
            actionKey = 'Updated'
            break
        case 'removed':
            actionKey = 'Removed'
            break
        default:
            throw new UnexpectedTxMetaChangeError({action, type})
    }
    return effectTypes[`${type}Sponsorship${actionKey}`]
}

/**
 * Check if asset issuer is a source account
 * @param {String} account
 * @param {String} asset
 * @return {Boolean}
 */
function isIssuer(account, asset) {
    return asset.includes(account)
}

module.exports = {
    fromStroops,
    toStroops,
    trimZeros,
    normalizeAddress,
    encodeSponsorshipEffectName,
    isIssuer,
    isAsset,
    diff
}
