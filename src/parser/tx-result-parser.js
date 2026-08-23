const {xdr} = require('@stellar/stellar-sdk')
const {
    xdrParseAccountAddress,
    xdrParseTradeAtom,
    xdrParseClaimedOffer,
    xdrParseAsset,
    xdrParseHex
} = require('./tx-xdr-parser-utils')
const {TxMetaEffectParserError} = require('../errors')

/**
 * Parse extra data from operation result
 * @param {Object} rawOpResult - Operation result XDR
 * @return {Object}
 */
function parseRawOpResult(rawOpResult) {
    const inner = rawOpResult.tr
    if (inner === undefined)
        return null //"opNoAccount" Case
    const opResult = inner.value
    const resultType = opResult.type

    //no need to parse failed operations - every non-negative op result code is a "success" variant
    if (!resultType.endsWith('Success'))
        return null

    const res = {
        resultType
    }

    switch (resultType) {
        case 'pathPaymentStrictReceiveSuccess':
        case 'pathPaymentStrictSendSuccess': {
            res.claimedOffers = opResult.value.offers.map(claimedOffer => xdrParseClaimedOffer(claimedOffer))
            const paymentValue = opResult.value.last
            res.payment = {
                account: xdrParseAccountAddress(paymentValue.destination),
                amount: paymentValue.amount.toString(),
                asset: xdrParseAsset(paymentValue.asset)
            }
        }
            break
        case 'manageSellOfferSuccess':
        case 'manageBuyOfferSuccess': {
            const makerOfferXdr = opResult.value.offer.value
            res.makerOffer = makerOfferXdr && xdrParseTradeAtom(makerOfferXdr)
            res.claimedOffers = opResult.value.offersClaimed.map(claimedOffer => xdrParseClaimedOffer(claimedOffer))
        }
            break
        case 'accountMergeSuccess':
            //retrieve the actual amount of transferred XLM
            res.actualMergedAmount = opResult.sourceAccountBalance.toString()
            break
        case 'inflationSuccess':
            res.inflationPayouts = (opResult.payouts || []).map(payout => ({
                account: xdrParseAccountAddress(payout.destination),
                amount: payout.amount.toString()
            }))
            break
        case 'createClaimableBalanceSuccess':
            res.balanceId = xdrParseHex(opResult.balanceId.value)
            break
        case 'invokeHostFunctionSuccess':
            res.result = opResult.value
            break
        case 'setOptionsSuccess':
        case 'manageDataSuccess':
        case 'createAccountSuccess':
        case 'paymentSuccess':
        case 'changeTrustSuccess':
        case 'allowTrustSuccess':
        case 'bumpSequenceSuccess':
        case 'claimClaimableBalanceSuccess':
        case 'beginSponsoringFutureReservesSuccess':
        case 'endSponsoringFutureReservesSuccess':
        case 'revokeSponsorshipSuccess':
        case 'clawbackSuccess':
        case 'clawbackClaimableBalanceSuccess':
        case 'setTrustLineFlagsSuccess':
        case 'liquidityPoolDepositSuccess':
        case 'liquidityPoolWithdrawSuccess':
        case 'restoreFootprintSuccess':
        case 'extendFootprintTtlSuccess':
            break //no extra info available
        default:
            throw new TxMetaEffectParserError(`Unknown op result: ${resultType}`)
    }
    return res
}

/**
 * @typedef {Object} ParsedTxResult
 * @property {Object} feeCharged
 * @property {Boolean} success
 * @property {Array<Object>} opResults
 */

/**
 * Parse single transaction result.
 * @param {Object|String} result - Raw transaction result XDR.
 * @return {ParsedTxResult}
 */
function parseTxResult(result) {
    if (typeof result === 'string') {
        result = xdr.TransactionResult.fromXdr(result, 'base64')
    }
    const innerResult = result.result
    const txResultState = innerResult.type
    const feeCharged = result.feeCharged.toString()
    const success = xdr.TransactionResultCode[txResultState].value >= 0

    let opResults = []
    if (success) {
        switch (txResultState) {
            case 'txFeeBumpInnerSuccess':
                //const childTxHash = innerResult.innerResultPair.transactionHash
                opResults = (innerResult.value.result.result.results || []).map(parseRawOpResult)
                break
            case 'txSuccess':
                opResults = (innerResult.results || []).map(parseRawOpResult)
                break
            default:
                throw new TxMetaEffectParserError(`Invalid tx result state switch: ${txResultState}`)
        }
    }
    return {
        success,
        opResults,
        feeCharged
    }
}

module.exports = {parseTxResult}
