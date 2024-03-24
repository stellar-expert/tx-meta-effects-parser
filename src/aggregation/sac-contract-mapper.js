const TtlCache = require('../cache/ttl-cache')
const {toStellarAsset} = require('../parser/tx-xdr-parser-utils')
const {contractIdFromAsset} = require('../parser/contract-preimage-encoder')

const sacCache = new TtlCache()

/**
 * Check and map SAC contract addresses with Classic assets
 * @param {EffectsAnalyzer} effectsAnalyzer
 * @param {String} contractAddress
 * @param {String} classicAsset
 * @return {Boolean}
 */
function mapSacContract(effectsAnalyzer, contractAddress, classicAsset) {
    if (!classicAsset)
        return false
    const {network, sacMap} = effectsAnalyzer
    //try to load from cache first
    const fromCache = sacCache.get(contractAddress + network)
    if (!fromCache) {
        const encodedContract = contractIdFromAsset(toStellarAsset(classicAsset), network)
        sacCache.set(encodedContract + network, classicAsset)
        if (encodedContract !== contractAddress)
            return false
    } else if (classicAsset !== fromCache)
        return false //check whether validated contract from cache matches the asset
    if (sacMap) {
        sacMap[contractAddress] = classicAsset
    }
    return true
}

/**
 * Dispose SAC cache mapping and release cleanup timers
 */
function disposeSacCache() {
    sacCache.dispose()
}

module.exports = {mapSacContract, disposeSacCache}