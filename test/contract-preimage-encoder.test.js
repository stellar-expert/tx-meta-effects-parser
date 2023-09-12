const {Asset, xdr} = require('stellar-base')
const {contractIdFromAsset, contractIdFromPreimage} = require('../src/contract-preimage-encoder')

const futurenetPassphrase = 'Test SDF Future Network ; October 2022'

describe('contractIdFromAsset()', () => {
    test('Native token', () => {
        expect(contractIdFromAsset(Asset.native(), futurenetPassphrase))
            .toEqual('CB64D3G7SM2RTH6JSGG34DDTFTQ5CFDKVDZJZSODMCX4NJ2HV2KN7OHT')
    })
    test('AlphaNum4 token', () => {
        expect(contractIdFromAsset(new Asset('USD', 'GCP2QKBFLLEEWYVKAIXIJIJNCZ6XEBIE4PCDB6BF3GUB6FGE2RQ3HDVP'), futurenetPassphrase))
            .toEqual('CCWNZPARJG7KQ6N4BGZ5OBWKSSK4AVQ5URLDRXB4ZJXKGEJQTIIRPAHN')
    })
})

describe('contractIdFromPreimage()', () => {
    test('fromAddress', () => {
        expect(contractIdFromPreimage(xdr.ContractIdPreimage.fromXDR('AAAAAAAAAAAAAAAAaL+VY7iSo8qhzZTpU+N6j9cGAqdCUB7a2XxwM3ySxARIphZVO8UGRqhbpwse7WkQtfO9yx4c4s8XoUMCKGiQNg==', 'base64'), futurenetPassphrase))
            .toEqual('CCMWY6VNP77CH6CZUPOPHKIBNI6TQKRFAIGPTPLUAGD6GWHLHFJASVJB')
    })
})