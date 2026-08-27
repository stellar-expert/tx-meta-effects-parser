const {Asset, StrKey, hash, xdr} = require('@stellar/stellar-sdk')

const passphraseMapping = {}

/**
 * Resolve network id hash from a passphrase (with pre-caching)
 * @param {String} networkPassphrase
 * @return {Uint8Array}
 */
function getNetworkIdHash(networkPassphrase) {
    let networkId = passphraseMapping[networkPassphrase]
    if (!networkId) {
        networkId = passphraseMapping[networkPassphrase] = hash(networkPassphrase)
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
    return contractIdFromPreimage(xdr.ContractIdPreimage.contractIdPreimageFromAsset(asset.toXdrObject()), networkPassphrase)
}

/**
 * Derive ContractId from a hash preimage
 * @param {ContractIdPreimage} contractIdPreimage
 * @param {String} networkPassphrase
 * @return {String}
 */
function contractIdFromPreimage(contractIdPreimage, networkPassphrase) {
    const hashPreimage = new xdr.HashIdPreimageContractId({
        networkId: new xdr.Hash(getNetworkIdHash(networkPassphrase)),
        contractIdPreimage
    })
    const envelopePreimage = xdr.HashIdPreimage.envelopeTypeContractId(hashPreimage)
    return StrKey.encodeContract(hash(envelopePreimage.toXdr()))
}

module.exports = {contractIdFromAsset, contractIdFromPreimage}
