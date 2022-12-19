# @stellar-expert/tx-meta-effects-parser

> Low-level effects parser for Stellar transaction results and meta XDR

## Installation

```
npm i github:@stellar-expert/tx-meta-effects-parser
```

## Usage

```js
const {parseTxOperationsMeta} = require('@stellar-expert/tx-meta-effects-parser')

const res = parseTxOperationsMeta({
    network: 'Public Global Stellar Network ; September 2015',
    tx: '_base64-encoded_transaction_envelope_XDR_',
    result: '_base64-encoded_transaction_result_XDR_',
    meta: '_base64-encoded_transaction_result_meta_XDR_'
})

console.log(res.effects)
console.log(res.operations[0].effects)
```
