/*eslint-disable no-undef */
const {Networks} = require('@stellar/stellar-base')
const effectTypes = require('../src/effect-types')
const {parseTxOperationsMeta, disposeSacCache} = require('../src')
const fs = require('fs')
const path = require('path')

function resolveNetwork(network) {
    if (!network)
        return 'Test SDF Future Network ; October 2022' //futurenet by default
    if (network.includes(' '))
        return network
    return Networks[network.toUpperCase()] //predefined
}

describe('Effects', () => {
    test.each(loadTestData('classic-ops'))('Classic ops - %s', (description, params) => {
        const {tx, result, meta, expected, network} = params
        const res = parseTxOperationsMeta({
            network: resolveNetwork(network),
            tx,
            result,
            meta,
            processFailedOpEffects: true
        })

        for (let i = 0; i < res.operations.length; i++) {
            expect(res.operations[i].effects).toStrictEqual(expected[i])
        }
    })

    test.each(loadTestData('soroban'))('Soroban - %s', (description, params) => {
        const {tx, result, meta, expected, network} = params
        const res = parseTxOperationsMeta({
            network: resolveNetwork(network),
            tx,
            result,
            meta,
            mapSac: true,
            processFailedOpEffects: true,
            processMetrics: false
        })

        for (let i = 0; i < res.operations.length; i++) {
            expect(res.operations[i].effects).toStrictEqual(expected[i])
        }
    })

    test.each(loadTestData('soroban-errors'))('Soroban errors - %s', (description, params) => {
        const {tx, result, meta, expected, network} = params
        const res = parseTxOperationsMeta({
            network: resolveNetwork(network),
            tx,
            result,
            meta,
            mapSac: true,
            processFailedOpEffects: true,
            processMetrics: false
        })

        for (let i = 0; i < res.operations.length; i++) {
            expect(res.operations[i].effects).toStrictEqual(expected[i])
        }
    })

    test.each(loadTestData('contract-metrics'))('Contract metrics - %s', (description, params) => {
        const {tx, result, meta, expected, network, processFailedOpEffects} = params
        const res = parseTxOperationsMeta({
            network: resolveNetwork(network),
            tx,
            result,
            meta,
            processSystemEvents: true,
            mapSac: true,
            processFailedOpEffects
        })
        expect(res.operations[0].effects.filter(e => e.type === effectTypes.contractMetrics || e.type === effectTypes.contractError)).toEqual(expected[0])
    })

    test.each(loadTestData('sac-map'))('SAC map - %s', (description, params) => {
        const {tx, result, meta, expected, network} = params
        const res = parseTxOperationsMeta({
            network: resolveNetwork(network),
            tx,
            result,
            meta,
            mapSac: true
        })
        const {sacMap} = res.operations[0]
        expect(sacMap ? Object.fromEntries(sacMap) : undefined).toEqual(expected || undefined)
    })

    test.each(loadTestData('tx-effects'))('Transaction-level - %s', (description, params) => {
        const {tx, result, meta, expected, network} = params
        const res = parseTxOperationsMeta({
            network: resolveNetwork(network),
            tx,
            result,
            meta,
            processFailedOpEffects: true
        })

        expect(res.effects).toStrictEqual(expected)
    })

    test.each(loadTestData('quirks'))('Quirks - %s', (description, params) => {
        const {tx, result, meta, expected, network, normalFee} = params
        const res = parseTxOperationsMeta({
            network: resolveNetwork(network),
            tx,
            result,
            meta,
            protocol: 20
        })

        expect(res.effects).toStrictEqual(expected)

        const normal = parseTxOperationsMeta({
            network: resolveNetwork(network),
            tx,
            result,
            meta
        })

        expect(normal.effects[0]).toStrictEqual({...expected[0], charged: normalFee})
    })

    afterAll(() => {
        disposeSacCache()
    })
})

function loadTestData(dir) {
    const res = []
    const dirPath = path.join(__dirname, './tx-parser-data', dir)
    for (const file of fs.readdirSync(dirPath)) {
        if (!file.endsWith('.json'))
            continue

        const filePath = path.join(dirPath, file)
        const baseName = path.basename(file, '.json')
        const testData = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        res.push([baseName, testData])
    }
    return res
}