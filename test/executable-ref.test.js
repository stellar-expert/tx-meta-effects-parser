const {xdr, Address, Networks} = require('@stellar/stellar-sdk')
const effectTypes = require('../src/effect-types')
const {EffectsAnalyzer} = require('../src/effects-analyzer')
const {parseLedgerEntryChanges} = require('../src/parser/ledger-entry-changes-parser')
const {xdrParseScVal} = require('../src/parser/tx-xdr-parser-utils')

const owner = 'CATF2IK7TVCUHK4KMGNKBN2OBBAT5NA3JAPXY2DHS2U5QMFPDUWL5DTJ'
const contract = 'CBZKN44ROE3F2P6XDIUQ675I2MTMVIQPMFKM75AZNS3MJ6VFMYVBESXW'
const source = 'GBLWPGXVH47YGMODIUHZJ7FETRISFU3TB7JGADTRIMU36OLWJ7PYEZ6M'
const wasmA = Buffer.alloc(32, 0xaa)
const wasmB = Buffer.alloc(32, 0xbb)
const hexA = wasmA.toString('hex')
const hexB = wasmB.toString('hex')

function externalRefExecutable(refOwner = owner, tag = 'pocket') {
    return xdr.ContractExecutable.contractExecutableExternalRef(new xdr.ContractExecutableExternalRef({
        executableOwner: new Address(refOwner).toScAddress(),
        tag
    }))
}

function contractInstance(executable, storage = null) {
    return xdr.ScVal.scvContractInstance(new xdr.ScContractInstance({executable, storage}))
}

function contractDataEntry(address, key, val) {
    return new xdr.LedgerEntry({
        lastModifiedLedgerSeq: 1,
        data: xdr.LedgerEntryData.contractData(new xdr.ContractDataEntry({
            ext: xdr.ExtensionPoint.v0(),
            contract: new Address(address).toScAddress(),
            key,
            durability: xdr.ContractDataDurability.persistent,
            val
        })),
        ext: xdr.LedgerEntryExt.v0()
    })
}

function instanceChanges(beforeExecutable, afterExecutable) {
    const key = xdr.ScVal.scvLedgerKeyContractInstance()
    return [
        xdr.LedgerEntryChange.ledgerEntryState(contractDataEntry(contract, key, contractInstance(beforeExecutable))),
        xdr.LedgerEntryChange.ledgerEntryUpdated(contractDataEntry(contract, key, contractInstance(afterExecutable)))
    ]
}

/**
 * Run the analyzer over synthetic ledger entry changes and return contract lifecycle effects only
 * @param {LedgerEntryChange[]} meta
 * @return {{}[]}
 */
function analyzeContractEffects(meta) {
    const analyzer = new EffectsAnalyzer({
        operation: {type: 'bumpSequence', source},
        meta,
        network: Networks.TESTNET
    })
    return analyzer.analyze().filter(e => e.type === effectTypes.contractCreated ||
        e.type === effectTypes.contractUpdated ||
        e.type === effectTypes.contractRestored ||
        e.type.startsWith('contractExecutableRef'))
}

describe('Executable tag ScVal parser', () => {
    test('parses executable tag', () => {
        expect(xdrParseScVal(xdr.ScVal.scvExecutableTag('pocket'))).toBe('pocket')
    })

    test('parses contract instance with Wasm executable', () => {
        const instance = contractInstance(xdr.ContractExecutable.contractExecutableWasm(wasmA))
        expect(xdrParseScVal(instance)).toBe(wasmA.toString('base64'))
    })

    test('parses contract instance with Stellar asset executable', () => {
        const instance = contractInstance(xdr.ContractExecutable.contractExecutableStellarAsset())
        expect(xdrParseScVal(instance)).toBe('<StellarAsset>')
    })

    test('parses contract instance with external ref executable', () => {
        expect(xdrParseScVal(contractInstance(externalRefExecutable()))).toBe(`<ExternalRef:${owner}/pocket>`)
    })
})

describe('Executable tag ledger entry parser', () => {
    test('decodes external ref contract instance', () => {
        const key = xdr.ScVal.scvLedgerKeyContractInstance()
        const change = xdr.LedgerEntryChange.ledgerEntryCreated(contractDataEntry(contract, key, contractInstance(externalRefExecutable())))
        const [{after}] = parseLedgerEntryChanges([change])
        expect(after).toMatchObject({
            owner: contract,
            durability: 'instance',
            executableType: 'contractExecutableExternalRef',
            kind: 'external',
            executableOwner: owner,
            executableTag: 'pocket'
        })
    })

    test('decodes executable tag entry', () => {
        const change = xdr.LedgerEntryChange.ledgerEntryCreated(contractDataEntry(owner, xdr.ScVal.scvExecutableTag('pocket'), xdr.ScVal.scvBytes(wasmA)))
        const [{after}] = parseLedgerEntryChanges([change])
        expect(after).toMatchObject({
            owner,
            durability: 'persistent',
            executableTag: 'pocket',
            wasmHash: hexA
        })
    })

    test('ignores malformed executable tag entry value', () => {
        const change = xdr.LedgerEntryChange.ledgerEntryCreated(contractDataEntry(owner, xdr.ScVal.scvExecutableTag('pocket'), xdr.ScVal.scvU32(42)))
        const [{after}] = parseLedgerEntryChanges([change])
        expect(after.executableTag).toBe('pocket')
        expect(after.wasmHash).toBeUndefined()
    })
})

describe('Executable reference effects', () => {
    test('emits contractExecutableRefCreated for a new tag entry', () => {
        const change = xdr.LedgerEntryChange.ledgerEntryCreated(contractDataEntry(owner, xdr.ScVal.scvExecutableTag('pocket'), xdr.ScVal.scvBytes(wasmA)))
        expect(analyzeContractEffects([change])).toStrictEqual([{
            type: effectTypes.contractExecutableRefCreated,
            owner,
            tag: 'pocket',
            wasmHash: hexA,
            keyHash: '914eec2a39a7e416a27e7a8dd9df4a1f6009bf5095f4429e7c51d3858913a782',
            source
        }])
    })

    test('emits contractExecutableRefUpdated with prevWasmHash when the tag is re-pointed', () => {
        const key = xdr.ScVal.scvExecutableTag('pocket')
        const effects = analyzeContractEffects([
            xdr.LedgerEntryChange.ledgerEntryState(contractDataEntry(owner, key, xdr.ScVal.scvBytes(wasmA))),
            xdr.LedgerEntryChange.ledgerEntryUpdated(contractDataEntry(owner, key, xdr.ScVal.scvBytes(wasmB)))
        ])
        expect(effects).toStrictEqual([{
            type: effectTypes.contractExecutableRefUpdated,
            owner,
            tag: 'pocket',
            wasmHash: hexB,
            prevWasmHash: hexA,
            keyHash: '914eec2a39a7e416a27e7a8dd9df4a1f6009bf5095f4429e7c51d3858913a782',
            source
        }])
    })
})

describe('CAP-85 executable transition', () => {
    test('emits contractCreated for a new external ref contract', () => {
        const key = xdr.ScVal.scvLedgerKeyContractInstance()
        const change = xdr.LedgerEntryChange.ledgerEntryCreated(contractDataEntry(contract, key, contractInstance(externalRefExecutable())))
        expect(analyzeContractEffects([change])).toStrictEqual([{
            type: effectTypes.contractCreated,
            contract,
            kind: 'external',
            keyHash: '540d7072ec4951cc71b60b278e74aa6ce24c03fde5ad51f5609212e2fafe5891',
            executableOwner: owner,
            executableTag: 'pocket',
            source
        }])
    })

    test('skips the update when the reference has not changed', () => {
        const effects = analyzeContractEffects(instanceChanges(externalRefExecutable(), externalRefExecutable()))
        expect(effects).toStrictEqual([])
    })

    test('reports a re-targeted reference without prevWasmHash', () => {
        const effects = analyzeContractEffects(instanceChanges(externalRefExecutable(owner, 'v1'), externalRefExecutable(owner, 'v2')))
        expect(effects).toStrictEqual([{
            type: effectTypes.contractUpdated,
            contract,
            kind: 'external',
            keyHash: '540d7072ec4951cc71b60b278e74aa6ce24c03fde5ad51f5609212e2fafe5891',
            executableOwner: owner,
            executableTag: 'v2',
            prevExecutableOwner: owner,
            prevExecutableTag: 'v1',
            source
        }])
    })

    test('reports a switch from Wasm to an external reference', () => {
        const effects = analyzeContractEffects(instanceChanges(xdr.ContractExecutable.contractExecutableWasm(wasmA), externalRefExecutable()))
        expect(effects).toStrictEqual([{
            type: effectTypes.contractUpdated,
            contract,
            kind: 'external',
            keyHash: '540d7072ec4951cc71b60b278e74aa6ce24c03fde5ad51f5609212e2fafe5891',
            executableOwner: owner,
            executableTag: 'pocket',
            prevKind: 'wasm',
            prevWasmHash: hexA,
            source
        }])
    })

    test('reports a switch from an external reference back to Wasm', () => {
        const effects = analyzeContractEffects(instanceChanges(externalRefExecutable(), xdr.ContractExecutable.contractExecutableWasm(wasmB)))
        expect(effects).toStrictEqual([{
            type: effectTypes.contractUpdated,
            contract,
            kind: 'wasm',
            keyHash: '540d7072ec4951cc71b60b278e74aa6ce24c03fde5ad51f5609212e2fafe5891',
            wasmHash: hexB,
            prevKind: 'external',
            prevExecutableOwner: owner,
            prevExecutableTag: 'pocket',
            source
        }])
    })
})

describe('Executable ref contract creation', () => {
    function createContractOp(executable) {
        const func = xdr.HostFunction.hostFunctionTypeCreateContract(new xdr.CreateContractArgs({
            contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(new xdr.ContractIdPreimageFromAddress({
                address: new Address(source).toScAddress(),
                salt: Buffer.alloc(32, 1)
            })),
            executable
        }))
        return {type: 'invokeHostFunction', source, func}
    }

    /**
     * @param {{}} executable
     * @return {{}[]}
     */
    function analyzeOp(executable) {
        const analyzer = new EffectsAnalyzer({
            operation: createContractOp(executable),
            meta: [],
            network: Networks.TESTNET
        })
        return analyzer.analyze()
    }

    test('does not emit an operation-level effect for an external ref executable', () => {
        expect(analyzeOp(externalRefExecutable())).toStrictEqual([])
    })

    test('does not emit an operation-level effect for a Wasm executable', () => {
        expect(analyzeOp(xdr.ContractExecutable.contractExecutableWasm(wasmA))).toStrictEqual([])
    })

    test('emits fromAddress creation for a Stellar asset executable', () => {
        const effects = analyzeOp(xdr.ContractExecutable.contractExecutableStellarAsset())
        expect(effects).toHaveLength(1)
        expect(effects[0]).toMatchObject({
            type: effectTypes.contractCreated,
            kind: 'fromAddress',
            issuer: source,
            salt: Buffer.alloc(32, 1).toString('base64')
        })
    })
})
