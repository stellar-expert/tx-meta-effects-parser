const {StrKey, LiquidityPoolId} = require('stellar-sdk')

/**
 * Parse account address from XDR representation
 * @param accountId
 * @param muxedAccountsSupported
 * @return {String|{muxedId: String, primary: String}}
 */
function xdrParseAccountAddress(accountId, muxedAccountsSupported = false) {
    if (!accountId) return undefined
    if (accountId.arm) {
        switch (accountId.arm()) {
            case 'ed25519':
                return StrKey.encodeEd25519PublicKey(accountId.ed25519())
            case 'med25519':
                if (!muxedAccountsSupported)
                    throw new Error(`Muxed accounts not supported here`)
                return {
                    primary: StrKey.encodeEd25519PublicKey(accountId.value().ed25519()),
                    muxedId: accountId.value().id().toString()
                }
            default:
                throw new Error(`Unsupported muxed account type: ${accountId.arm()}`)
        }
    }
    if (accountId instanceof Buffer) {
        return StrKey.encodeEd25519PublicKey(accountId)
    }
    throw new TypeError(`Failed to identify and parse account address: ${accountId}`)
}

/**
 * Parse XDR price representation
 * @param {{n: Function, d: Function}} price
 * @return {Number}
 */
function xdrParsePrice(price) {
    return price.n() / price.d()
}

/**
 * Parse account signer key XDR
 * @param {xdr.SignerKey} signer
 * @return {String}
 */
function xdrParseSignerKey(signer) {
    const type = signer.arm()
    switch (type) {
        case 'ed25519':
            return StrKey.encodeEd25519PublicKey(signer.ed25519())
        case 'preAuthTx':
            return StrKey.encodePreAuthTx(signer.preAuthTx())
        case 'hashX':
            return StrKey.encodeSha256Hash(signer.hashX())
        case 'ed25519SignedPayload':
            return StrKey.encodeSignedPayload(signer.ed25519SignedPayload()) //TODO: check
    }
    throw new Error(`Unsupported signer type: "${type}"`)
}


/**
 * @typedef {Object} ParsedOffer
 * @property {String} account
 * @property {Array<String>} asset
 * @property {Array<String>} amount
 * @property {String} offerId?
 * @property {Buffer} poolId?
 */

/**
 * Parse maker offer descriptor from raw XDR.
 * @param {Object} offerXdr
 * @return {ParsedOffer}
 */
function xdrParseTradeAtom(offerXdr) {
    return {
        offerId: offerXdr.offerId().toString(),
        account: xdrParseAccountAddress(offerXdr.sellerId()),
        asset: [xdrParseAsset(offerXdr.selling()).toString(), xdrParseAsset(offerXdr.buying()).toString()],
        //offer amount is always stored in terms of a selling asset, even for buy offers
        amount: (offerXdr.amount() || offerXdr.buyAmount()).toString(),
        //flags: offerXdr.flags()
        price: xdrParsePrice(offerXdr.price())
    }
}

/**
 * Parse claimed offer atom from raw XDR.
 * @param {xdr.ClaimAtom} claimedAtom
 * @return {ParsedOffer}
 */
function xdrParseClaimedOffer(claimedAtom) {
    const atomType = claimedAtom.arm()
    let res
    switch (atomType) {
        case 'v0':
            claimedAtom = claimedAtom.v0()
            res = {
                account: xdrParseAccountAddress(claimedAtom.sellerEd25519()),
                offerId: claimedAtom.offerId().toString()
            }
            break
        case 'orderBook':
            claimedAtom = claimedAtom.orderBook()
            res = {
                account: xdrParseAccountAddress(claimedAtom.sellerId()),
                offerId: claimedAtom.offerId().toString()
            }
            break
        case 'liquidityPool':
            claimedAtom = claimedAtom.liquidityPool()
            res = {
                poolId: claimedAtom.liquidityPoolId()
            }
            break
        default:
            throw new Error(`Unsupported claimed atom type: ` + atomType)
    }
    return {
        asset: [
            xdrParseAsset(claimedAtom.assetSold()),
            xdrParseAsset(claimedAtom.assetBought())
        ],
        amount: [
            claimedAtom.amountSold().toString(),
            claimedAtom.amountBought().toString()
        ],
        ...res
    }
}

function xdrParseClaimantPredicate(predicate) {
    if (!predicate) return {}
    const type = predicate.switch().name
    const value = predicate.value()
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
            throw new Error(`Unknown claim condition predicate: ${type}`)
    }
}

function xdrParseClaimant(claimant) {
    const value = claimant.value()
    return {
        destination: xdrParseAccountAddress(value.destination()),
        predicate: xdrParseClaimantPredicate(value.predicate())
    }
}

function xdrParseAsset(src, prefix = '') {
    if (!src) return undefined

    if (src.arm) { //XDR
        switch (src.switch().name) {
            case 'assetTypeNative':
                return 'XLM'
            case 'assetTypePoolShare':
            {
                const poolId = src.value()
                if (poolId.length)
                    return poolId.toString('hex')
                if (poolId.constantProduct)
                    return LiquidityPoolId.fromOperation(poolId).getLiquidityPoolId()
                throw new Error('Unsupported liquidity pool asset id format')
            }
            default:
            {
                const value = src.value()
                return `${value.assetCode().toString().replace(/\0+$/, '')}-${StrKey.encodeEd25519PublicKey(value.issuer().ed25519())}-${src.arm() === 'alphaNum4' ? 1 : 2}`
            }
        }
    }

    if (typeof src === 'string') {
        if (src === 'XLM' || src.includes('-'))
            return src//already parsed value
        if (src.includes(':')) {
            const [code, issuer] = src.split(':')
            return `${code}-${issuer}-${code.length > 4 ? 2 : 1}`
        }
        if (src.length === 64)
            return src //pool id
    }
    if (src.type === 0 && !src.code || src.code === 'XLM' && !src.issuer)
        return 'XLM'
    if (src.code && src.issuer)
        return `${src.code}-${src.issuer}-${src.type || (src.code.length > 4 ? 2 : 1)}`
}

module.exports = {
    xdrParseAsset,
    xdrParseAccountAddress,
    xdrParseClaimant,
    xdrParseClaimedOffer,
    xdrParseTradeAtom,
    xdrParseSignerKey,
    xdrParsePrice
}
