const {Asset, StrKey, hash, xdr} = require('stellar-base')

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
 * Encode ContractId for a given wrapped Stellar classic asset
 * @param {Asset|String} asset
 * @param {String} networkPassphrase
 * @return {String}
 */
function encodeAssetContractId(asset, networkPassphrase) {
    if (typeof asset === 'string') {
        if (asset === 'native') {
            asset = Asset.native()
        } else if (asset.includes(':')) {
            const [code, issuer] = asset.split(':')
            asset = new Asset(code.replace(/\0+$/, ''), issuer)
        } else if (asset.startsWith('C')) { //treat as contract address
            return asset
        }
    }
    const assetContractId = new xdr.HashIdPreimageContractId({
        networkId: getNetworkIdHash(networkPassphrase),
        contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAsset(asset.toXDRObject())
    })
    const preimage = xdr.HashIdPreimage.envelopeTypeContractId(assetContractId)
    return StrKey.encodeContract(hash(preimage.toXDR()))
}

module.exports = {encodeAssetContractId}