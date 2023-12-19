const {Asset, StrKey, hash, xdr} = require('@stellar/stellar-base')

const passphraseMapping = {}

/**
 * Resolve network id hash from a passphrase (with pre-caching)
 * @param {String} networkPassphrase
 * @return {Buffer}
 */
function getNetworkIdHash(networkPassphrase) {
    let networkId = passphraseMapping[networkPassphrase]
    if (!networkId) {
        networkId = passphraseMapping[networkPassphrase] = hash(Buffer.from(networkPassphrase))
    }
    return networkId
}

/**
 * Derive ContractId from a wrapped Stellar classic asset
 * @param {Asset} asset
 * @param {String} networkPassphrase
 * @return {String}
 */
function contractIdFromAsset(asset, networkPassphrase) {
    return contractIdFromPreimage(xdr.ContractIdPreimage.contractIdPreimageFromAsset(asset.toXDRObject()), networkPassphrase)
}

/**
 * Derive ContractId from a hash preimage
 * @param {ContractIdPreimage} contractIdPreimage
 * @param {String} networkPassphrase
 * @return {String}
 */
function contractIdFromPreimage(contractIdPreimage, networkPassphrase) {
    const hashPreimage = new xdr.HashIdPreimageContractId({
        networkId: getNetworkIdHash(networkPassphrase),
        contractIdPreimage
    })
    const envelopePreimage = xdr.HashIdPreimage.envelopeTypeContractId(hashPreimage)
    return StrKey.encodeContract(hash(envelopePreimage.toXDR()))
}

module.exports = {contractIdFromAsset, contractIdFromPreimage}