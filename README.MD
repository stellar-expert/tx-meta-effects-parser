# @stellar-expert/tx-meta-effects-parser

> Low-level effects parser for Stellar transaction results and meta XDR

Some [Stellar](https://stellar.org) operations yield non-deterministic results,
so developers often have to pull the data from Horizon `/effects` API endpoints.
This package provides the ability to retrieve atomic ledger state modifications
directly from the transaction execution result and metadata.

## Installation

```
npm i @stellar-expert/tx-meta-effects-parser
```

## Usage

```js
const {parseTxOperationsMeta} = require('@stellar-expert/tx-meta-effects-parser')

const res = parseTxOperationsMeta({
    network: 'Public Global Stellar Network ; September 2015',
    tx: '_base64-encoded_transaction_envelope_XDR_', // trasnaction envelope XDR
    result: '_base64-encoded_transaction_result_XDR_', // trasnaction result XDR
    meta: '_base64-encoded_transaction_result_meta_XDR_', // trasnaction meta XDR
    processSystemEvents: false, // whether to analyze system Soroban diagnostic events
    mapSac: false, // whether to map Classic assets to Soroban contracts automatically
    processFailedOpEffects: false, // whether to analyze effects in failed transactions
    protocol: 21 // different versions of Stelalr protocol may yield uninform effects  
})

console.log(res.effects)
console.log(res.operations[0].effects)
```

Example:

```js
parseTxOperationsMeta({
    network: 'Public Global Stellar Network ; September 2015',
    tx: 'AAAAAgAAAABU95GyQJbC5BUk8MOfuB2kGJMPNikp/uVdnGQ9ALDarAAAJxAAAJvZAAAAAQAAAAEAAAAAAAAAAAAAAABjnO8XAAAAAAAAAAEAAAABAAAAAGwpaFzT4YYOFQorR1hvkzU9himxtEbBMKbb/qeCkpPhAAAACAAAAABU95GyQJbC5BUk8MOfuB2kGJMPNikp/uVdnGQ9ALDarAAAAAAAAAACALDarAAAAED9Omj2K+pvRUV6jGicOlyZ7F5Jg82yj6rK0VKPSo8eOlfAkJt2AfcSYhB1HUODhbgpwHryTNjJZr8HLy3H/8wFgpKT4QAAAEAqlaQs1KKyIp5/aGFg+KRyIwR2wB+UE+PoEJC7EkyK3DNET09EDWqRCTZjZlNnvAPtw+R0ZXndNsPxZtqKjnsF',
    result: 'AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAAIAAAAAAAAABdIdugAAAAAAA==',
    meta: 'AAAAAgAAAAIAAAADAACb3QAAAAAAAAAAVPeRskCWwuQVJPDDn7gdpBiTDzYpKf7lXZxkPQCw2qwAAAAXSHbnnAAAm9kAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAABAACb3QAAAAAAAAAAVPeRskCWwuQVJPDDn7gdpBiTDzYpKf7lXZxkPQCw2qwAAAAXSHbnnAAAm9kAAAABAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAwAAAAAAAJvdAAAAAGOcyAwAAAAAAAAAAQAAAAQAAAADAACb2gAAAAAAAAAAbCloXNPhhg4VCitHWG+TNT2GKbG0RsEwptv+p4KSk+EAAAAXSHboAAAAm9oAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAABsKWhc0+GGDhUKK0dYb5M1PYYpsbRGwTCm2/6ngpKT4QAAAAMAAJvdAAAAAAAAAABU95GyQJbC5BUk8MOfuB2kGJMPNikp/uVdnGQ9ALDarAAAABdIduecAACb2QAAAAEAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAADAAAAAAAAm90AAAAAY5zIDAAAAAAAAAABAACb3QAAAAAAAAAAVPeRskCWwuQVJPDDn7gdpBiTDzYpKf7lXZxkPQCw2qwAAAAukO3PnAAAm9kAAAABAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAwAAAAAAAJvdAAAAAGOcyAwAAAAAAAAAAA=='
})

/*json
{
  effects: [
    {
      "type": "feeCharged",
      "source": "GBKPPENSICLMFZAVETYMHH5YDWSBREYPGYUST7XFLWOGIPIAWDNKYDLI",
      "asset": "XLM",
      "bid": "10000",
      "charged": "100"
    }
  ],
  operations: [
    {
      "source": "GBWCS2C42PQYMDQVBIVUOWDPSM2T3BRJWG2ENQJQU3N75J4CSKJ6DXHN",
      "type": "accountMerge",
      "destination": "GBKPPENSICLMFZAVETYMHH5YDWSBREYPGYUST7XFLWOGIPIAWDNKYDLI",
      "effects": [
        {
          "type": "accountDebited",
          "source": "GBWCS2C42PQYMDQVBIVUOWDPSM2T3BRJWG2ENQJQU3N75J4CSKJ6DXHN",
          "asset": "XLM",
          "amount": "100000000000",
          "balance": "0"
        },
        {
          "type": "accountRemoved",
          "source": "GBWCS2C42PQYMDQVBIVUOWDPSM2T3BRJWG2ENQJQU3N75J4CSKJ6DXHN"
        },
        {
          "type": "accountCredited",
          "source": "GBKPPENSICLMFZAVETYMHH5YDWSBREYPGYUST7XFLWOGIPIAWDNKYDLI",
          "asset": "XLM",
          "amount": "100000000000",
          "balance": "199999999900"
        }
      ]
    }
  ],
  "isEphemeral": false,
  "tx": {}
}
 */
```

## All effects

<table>
<tr>
<th>Effect</th> <th>Operations</th> <th>Example</th>
</tr>

<tr>
<td>
<sub><code>feeCharged</code></sub>
</td>
<td><sub>Transaction, FeeBumpTransaction</sub></td>
<td>

```js
{
  type: 'feeCharged',
  source: 'GBKP…YDLI',
  asset: 'XLM',
  bid: '10000',
  charged: '100'
}
```
</td>
</tr>

<tr>
<td>
<sub><code>accountCreated</code></sub>
</td>
<td><sub>CreateAccountOp</sub></td>
<td>

```js
{
  type: 'accountCreated',
  source: 'GBKP…YDLI',
  account: 'GBWC…DXHN'
}
```
</td>
</tr>

<tr>
<td>
<sub><code>accountRemoved</code></sub>
</td>
<td><sub>AccountMergeOp</sub></td>
<td>

```js
{
  type: 'accountRemoved',
  source: 'GBKP…YDLI'
}
```
</td>
</tr>

<tr>
<td>
<sub><code>accountDebited</code></sub>
</td>
<td><sub>CreateAccountOp, AccountMergeOp, PaymentOp, PathPaymentStrictReceiveOp,
PathPaymentStrictSendOp, CreateClaimableBalanceOp, ClawbackOp</sub></td>
<td>

```js
{
  type: 'accountDebited',
  source: 'GBKP…YDLI',
  asset: 'XLM',
  amount: '1000000000'
}
```
</td>
</tr>

<tr>
<td>
<sub><code>accountCredited</code></sub>
</td>
<td><sub>CreateAccountOp, AccountMergeOp, PaymentOp, PathPaymentStrictReceiveOp,
PathPaymentStrictSendOp, ClaimClaimableBalanceOp, ClawbackOp, 
ClawbackClaimableBalance, InflationOp</sub></td>
<td>

```js
{
  type: 'accountCredited',
  source: 'GBWC…DXHN',
  asset: 'XLM',
  amount: '1000000000'
}
```
</td>
</tr>

<tr>
<td>
<sub><code>accountHomeDomainUpdated</code></sub>
</td>
<td><sub>SetOptionsOp</sub></td>
<td>

```js
{
  type: 'accountHomeDomainUpdated',
  source: 'GBWC…DXHN',
  domain: 'example.com'
}
```
</td>
</tr>

<tr>
<td>
<sub><code>accountThresholdsUpdated</code></sub>
</td>
<td><sub>SetOptionsOp</sub></td>
<td>

```js
{
  type: 'accountThresholdsUpdated',
  source: 'GBWC…DXHN',
  thresholds: [1, 1 ,3]
}
```
</td>
</tr>

<tr>
<td>
<sub><code>accountFlagsUpdated</code></sub>
</td>
<td><sub>SetOptionsOp</sub></td>
<td>

```js
{
  type: 'accountFlagsUpdated',
  source: 'GBWC…DXHN',
  flags: 2,
  prevFlags: 0
}
```
</td>
</tr>

<tr>
<td>
<sub><code>accountInflationDestinationUpdated</code></sub>
</td>
<td><sub>SetOptionsOp</sub></td>
<td>

```js
{
  type: 'accountInflationDestinationUpdated',
  source: 'GBWC…DXHN',
  inflationDestination: 'GBKP…YDLI'
}
```
</td>
</tr>

<tr>
<td>
<sub><code>accountSignerCreated</code></sub>
</td>
<td><sub>SetOptionsOp</sub></td>
<td>

```js 
{
  type: 'accountSignerCreated',
  source: 'GBWC…DXHN',
  signer: 'GBKP…YDLI',
  weight: 1,
  signers: [
    {key: 'GBWC…DXHN', weight: 1},
    {key: 'GBKP…YDLI', weight: 1}
  ]
}
```

</td>
</tr>

<tr>
<td>
<sub><code>accountSignerUpdated</code></sub>
</td>
<td><sub>SetOptionsOp</sub></td>
<td>

```js 
{
  type: 'accountSignerUpdated',
  source: 'GBWC…DXHN',
  signer: 'GBKP…YDLI',
  weight: 2,
  signers: [
    {key: 'GBWC…DXHN', weight: 2},
    {key: 'GBKP…YDLI', weight: 1}
  ]
}
```

</td>
</tr>

<tr>
<td>
<sub><code>accountSignerRemoved</code></sub>
</td>
<td><sub>SetOptionsOp</sub></td>
<td>

```js
{
  type: 'accountSignerRemoved',
  source: 'GBWC…DXHN',
  weight: 0,
  signer: 'GBKP…YDLI',
  signers: [
    {key: 'GBWC…DXHN', weight: 1}
  ]
}
```

</td>
</tr>

<tr>
<td>
<sub><code>trustlineCreated</code></sub>
</td>
<td><sub>ChangeTrustOp</sub></td>
<td>

```js
{
  type: 'trustlineCreated',
  source: 'GBWC…DXHN',
  asset: 'USD-GBKP…YDLI-1',
  kind: 'asset',
  limit: '1000000000',
  flags: 1
}
```

</td>
</tr>

<tr>
<td>
<sub><code>trustlineUpdated</code></sub>
</td>
<td><sub>ChangeTrustOp, AllowTrustOp, SetTrustLineFlagsOp</sub></td>
<td>

```js
{
  type: 'trustlineUpdated',
  source: 'GBWC…DXHN',
  asset: 'USD-GBKP…YDLI-1',
  kind: 'asset',
  limit: '2000000000',
  flags: 5
}
```

</td>
</tr>

<tr>
<td>
<sub><code>trustlineRemoved</code></sub>
</td>
<td><sub>ChangeTrustOp</sub></td>
<td>

```js
{
  type: 'trustlineRemoved',
  source: 'GBWC…DXHN',
  asset: 'USD-GBKP…YDLI-1',
  kind: 'asset',
  flags: 4,
}
```

</td>
</tr>

<tr>
<td>
<sub><code>trustlineAuthorizationUpdated</code></sub>
</td>
<td><sub>AllowTrustOp, SetTrustLineFlagsOp</sub></td>
<td>

```js
{
  type: 'trustlineAuthorizationUpdated',
  source: 'GBWC…DXHN',
  trustor: 'GBKP…YDLI',
  asset: 'USD-GBWC…DXHN-1',
  flags: 5,
  prevFlags: 2
}
```

</td>
</tr>

<tr>
<td>
<sub><code>assetMinted</code></sub>
</td>
<td><sub>PaymentOp, PathPaymentStrictReceiveOp, PathPaymentStrictSendOp, CreateClaimableBalanceOp,
ManageBuyOfferOp, ManageSellOfferOp, CreatePassiveOfferOp, DepositLiquidityOp</sub></td>
<td>

```js
{
  type: 'assetMinted',
  source: 'GBWC…DXHN',
  asset: 'USD-GBWC…DXHN-1',
  amount: '1000000000'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>assetBurned</code></sub>
</td>
<td><sub>PaymentOp, PathPaymentStrictReceiveOp, PathPaymentStrictSendOp, CreateClaimableBalanceOp, ManageBuyOfferOp, ManageSellOfferOp,
CreatePassiveOfferOp, WithdrawLiquidityOp, ClawbackOp,
ClaimClaimableBalanceOp</sub></td>
<td>

```js
{
  type: 'assetBurned',
  source: 'GBWC…DXHN',
  asset: 'USD-GBWC…DXHN-1',
  amount: '2000000000'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>offerCreated</code></sub>
</td>
<td><sub>CreatePassiveOfferOp, ManageBuyOfferOp, ManageSellOfferOp</sub></td>
<td>

```js
{
  type: 'offerCreated',
  source: 'GBWC…DXHN',
  offer: '90427',
  owner: 'GBWC…DXHN',
  amount: '1000000000',
  asset: [
    'USD-GBKP…YDLI-1',
    'XLM'
  ],
  price: 0.09215,
  flags: 0
}
```

</td>
</tr>

<tr>
<td>
<sub><code>offerUpdated</code></sub>
</td>
<td><sub>CreatePassiveOfferOp, ManageBuyOfferOp, ManageSellOfferOp, PathPaymentOp</sub></td>
<td>

```js
{
  type: 'offerUpdated',
  source: 'GBWC…DXHN',
  offer: '90427',
  owner: 'GBWC…DXHN',
  amount: '900000000',
  asset: [
    'USD-GBKP…YDLI-1',
    'XLM'
  ],
  price: 0.09215,
  flags: 0
}
```

</td>
</tr>

<tr>
<td>
<sub><code>offerRemoved</code></sub>
</td>
<td><sub>CreatePassiveOfferOp, ManageBuyOfferOp, ManageSellOfferOp, PathPaymentOp, AllowTrustOp, SetTrustLineFlagsOp</sub></td>
<td>

```js
{
  type: 'offerRemoved',
  source: 'GBWC…DXHN',
  offer: '90427',
  owner: 'GBWC…DXHN',
  asset: [
    'USD-GBKP…YDLI-1',
    'XLM'
  ],
  flags: 0
}
```

</td>
</tr>

<tr>
<td>
<sub><code>liquidityPoolCreated</code></sub>
</td>
<td><sub>ChangeTrustOp</sub></td>
<td>

```js
{
  type: 'liquidityPoolCreated',
  source: 'GBWC…DXHN',
  pool: '52a8…76f8',
  reserves: [
    {
      asset: 'XLM',
      amount: '0'
    },
    {
      asset: 'USD-GBKP…YDLI-1',
      amount: '0'
    }
  ],
  shares: '0',
  accounts: 1
}
```

</td>
</tr>

<tr>
<td>
<sub><code>liquidityPoolUpdated</code></sub>
</td>
<td><sub>DepositLiquidityOp, WithdrawLiquidityOp, AllowTrustOp, SetTrustLineFlagsOp</sub></td>
<td>

```js
{
  type: 'liquidityPoolUpdated',
  source: 'GBWC…DXHN',
  pool: '52a8…76f8',
  reserves: [
    {
      asset: 'XLM',
      amount: '10000000000'
    },
    {
      asset: 'USD-GBKP…YDLI-1',
      amount: '10000000000'
    }
  ],
  shares: '10000000000',
  accounts: 2
}
```

</td>
</tr>

<tr>
<td>
<sub><code>liquidityPoolDeposited</code></sub>
</td>
<td><sub>DepositLiquidityOp</sub></td>
<td>

```js
{
  type: 'liquidityPoolDeposited',
  source: 'GBWC…DXHN',
  pool: '52a8…76f8',
  assets: [
    {
      asset: 'XLM',
      amount: '10000000000'
    },
    {
      asset: 'USD-GBKP…YDLI-1',
      amount: '10000000000'
    }
  ],
  shares: '10000000000'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>liquidityPoolWithdrew</code></sub>
</td>
<td><sub>WithdrawLiquidityOp</sub></td>
<td>

```js
{
  type: 'liquidityPoolWithdrew',
  source: 'GBWC…DXHN',
  pool: '52a8…76f8',
  assets: [
    {
      asset: 'XLM',
      amount: '5000000000'
    },
    {
      asset: 'USD-GBKP…YDLI-1',
      amount: '5000000000'
    }
  ],
  shares: '5000000000'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>liquidityPoolRemoved</code></sub>
</td>
<td><sub>ChangeTrustOp, AllowTrustOp, SetTrustLineFlagsOp</sub></td>
<td>

```js
{
  type: 'liquidityPoolRemoved',
  source: 'GBWC…DXHN',
  pool: '52a8…76f8'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>trade</code></sub>
</td>
<td><sub>CreatePassiveOfferOp, ManageBuyOfferOp, ManageSellOfferOp, PathPaymentOp</sub></td>
<td>

```js
{
  type: 'trade',
  source: 'GBWC…DXHN',
  offer: '14834',
  amount: [
    '100000000', 
    '200000000'
  ],
  asset: [
    'USD-GBKP…YDLI-1',
    'XLM'
  ],
  seller: 'GBKP…YDLI'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>dataEntryCreated</code></sub>
</td>
<td><sub>ManageDataOp</sub></td>
<td>

```js
{
  type: 'dataEntryCreated',
  source: 'GBWC…DXHN',
  name: 'test',
  value: 'dGVzdA=='
}
```

</td>
</tr>

<tr>
<td>
<sub><code>dataEntryUpdated</code></sub>
</td>
<td><sub>ManageDataOp</sub></td>
<td>

```js
{
  type: 'dataEntryUpdated',
  source: 'GBWC…DXHN',
  name: 'test',
  value: 'dGVzVA=='
}
```

</td>
</tr>

<tr>
<td>
<sub><code>dataEntryRemoved</code></sub>
</td>
<td><sub>ManageDataOp</sub></td>
<td>

```js
{
  type: 'dataEntryRemoved',
  source: 'GBWC…DXHN',
  name: 'test'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>sequenceBumped</code></sub>
</td>
<td><sub>BumpSequenceOp</sub></td>
<td>

```js
{
  type: 'sequenceBumped',
  source: 'GBWC…DXHN',
  sequence: '9223372036854775707'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>inflation</code></sub>
</td>
<td><sub>InflationOp</sub></td>
<td>

```js
{
  type: 'inflation',
  source: 'GBWC…DXHN'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>claimableBalanceCreated</code></sub>
</td>
<td><sub>CreateClaimableBalanceOp, AllowTrustOp, SetTrustLineFlagsOp</sub></td>
<td>

```js
{
  type: 'claimableBalanceCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN',
  balance: '7aba…6f9d',
  asset: 'XLM',
  amount: '1000000000',
  claimants: [
    {
      destination: 'GBKP…YDLI',
      predicate: {
        absBefore: '1671220240580'
      }
    }
  ]
}
```

</td>
</tr>

<tr>
<td>
<sub><code>claimableBalanceRemoved</code></sub>
</td>
<td><sub>ClaimClaimableBalanceOp, ClawbackClaimableBalanceOp</sub></td>
<td>

```js
{
  type: 'claimableBalanceRemoved',
  source: 'GBKP…YDLI',
  sponsor: 'GBWC…DXHN',
  balance: '7aba…6f9d',
  asset: 'XLM',
  amount: '1000000000',
  claimants: [
    {
      destination: 'GBKP…YDLI',
      predicate: {
        absBefore: '1671220240580'
      }
    }
  ]
}
```

</td>
</tr>

<tr>
<td>
<sub><code>accountSponsorshipCreated</code></sub>
</td>
<td><sub>CreateAccountOp</sub></td>
<td>

```js
{
  type: 'accountSponsorshipCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>accountSponsorshipUpdated</code></sub>
</td>
<td><sub>RevokeSponsorshipOp</sub></td>
<td>

```js
{
  type: 'accountSponsorshipUpdated',
  source: 'GBWC…DXHN',
  sponsor: 'GDNP…CMXH',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>accountSponsorshipRemoved</code></sub>
</td>
<td><sub>RevokeSponsorshipOp</sub></td>
<td>

```js
{
  type: 'accountSponsorshipRemoved',
  source: 'GBWC…DXHN',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>trustlineSponsorshipCreated</code></sub>
</td>
<td><sub>ChangeThrustOp</sub></td>
<td>

```js
{
  type: 'trustlineSponsorshipCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  asset: 'USD-GBKP…YDLI-1'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>trustlineSponsorshipUpdated</code></sub>
</td>
<td><sub>RevokeSponsorshipOp</sub></td>
<td>

```js
{
  type: 'trustlineSponsorshipUpdated',
  source: 'GBWC…DXHN',
  sponsor: 'GDNP…CMXH',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  asset: 'USD-GBKP…YDLI-1'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>trustlineSponsorshipRemoved</code></sub>
</td>
<td><sub>RevokeSponsorshipOp</sub></td>
<td>

```js
{
  type: 'trustlineSponsorshipRemoved',
  source: 'GBWC…DXHN',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  asset: 'USD-GBKP…YDLI-1'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>offerSponsorshipCreated</code></sub>
</td>
<td><sub>CreatePassiveOfferOp, ManageBuyOfferOp, ManageSellOfferOp</sub></td>
<td>

```js
{
  type: 'offerSponsorshipCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  offer: '4523452'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>offerSponsorshipUpdated</code></sub>
</td>
<td><sub>RevokeSponsorshipOp</sub></td>
<td>

```js
{
  type: 'offerSponsorshipUpdated',
  source: 'GBWC…DXHN',
  sponsor: 'GDNP…CMXH',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  offer: '4523452'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>offerSponsorshipRemoved</code></sub>
</td>
<td><sub>RevokeSponsorshipOp</sub></td>
<td>

```js
{
  type: 'offerSponsorshipRemoved',
  source: 'GBWC…DXHN',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  offer: '4523452'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>dataSponsorshipCreated</code></sub>
</td>
<td><sub>ManageDataOp</sub></td>
<td>

```js
{
  type: 'dataSponsorshipCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  name: 'name'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>dataSponsorshipUpdated</code></sub> 
</td>
<td><sub>RevokeSponsorshipOp</sub></td>
<td>

```js
{
  type: 'dataSponsorshipUpdated',
  source: 'GBWC…DXHN',
  sponsor: 'GDNP…CMXH',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  name: 'name'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>dataSponsorshipRemoved</code></sub>
</td>
<td><sub>RevokeSponsorshipOp</sub></td>
<td>

```js
{
  type: 'dataSponsorshipRemoved',
  source: 'GBWC…DXHN',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  name: 'name'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>claimableBalanceSponsorshipCreated</code></sub>
</td>
<td><sub>CreateClaimableBalanceOp</sub></td>
<td>

```js
{
  type: 'claimableBalanceSponsorshipCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN',
  balance: '7aba…6f9d'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>claimableBalanceSponsorshipUpdated</code></sub>
</td>
<td><sub>RevokeSponsorshipOp</sub></td>
<td>

```js
{
  type: 'claimableBalanceSponsorshipUpdated',
  source: 'GBWC…DXHN',
  sponsor: 'GDNP…CMXH',
  prevSponsor: 'GBWC…DXHN',
  balance: '7aba…6f9d'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>claimableBalanceSponsorshipRemoved</code></sub>
</td>
<td><sub>RevokeSponsorshipOp</sub></td>
<td>

```js
{
  type: 'claimableBalanceSponsorshipRemoved',
  source: 'GBWC…DXHN',
  prevSponsor: 'GBWC…DXHN',
  balance: '7aba…6f9d'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>signerSponsorshipCreated</code></sub>
</td>
<td><sub>SetOptionsOp</sub></td>
<td>

```js
{
  type: 'signerSponsorshipCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN',
  signer: 'GALF…CR2V',
  account: 'GBKP…YDLI'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>signerSponsorshipUpdated</code></sub>
</td>
<td><sub>RevokeSponsorshipOp</sub></td>
<td>

```js 
{
  type: 'signerSponsorshipUpdated',
  source: 'GBWC…DXHN',
  sponsor: 'GDNP…CMXH',
  prevSponsor: 'GBWC…DXHN',
  signer: 'GALF…CR2V',
  account: 'GBKP…YDLI'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>signerSponsorshipRemoved</code></sub>
</td>
<td><sub>RevokeSponsorshipOp</sub></td>
<td>

```js
{
  type: 'signerSponsorshipRemoved',
  source: 'GBWC…DXHN',
  prevSponsor: 'GBWC…DXHN',
  signer: 'GALF…CR2V',
  account: 'GBKP…YDLI'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>liquidityPoolSponsorshipCreated</code></sub>
</td>
<td><sub>ChangeThrustOp</sub></td>
<td>

```js
{
  type: 'liquidityPoolSponsorshipCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>liquidityPoolSponsorshipUpdated</code></sub>
</td>
<td><sub>RevokeSponsorshipOp</sub></td>
<td>

```js
{
  type: 'liquidityPoolSponsorshipUpdated',
  source: 'GBWC…DXHN',
  sponsor: 'GDNP…CMXH',
  prevSponsor: 'GBWC…DXHN'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>liquidityPoolSponsorshipRemoved</code></sub>
</td>
<td><sub>RevokeSponsorshipOp</sub></td>
<td>

```js
{
  type: 'liquidityPoolSponsorshipRemoved',
  source: 'GBWC…DXHN',
  prevSponsor: 'GBWC…DXHN'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>contractCodeUploaded</code></sub>
</td>
<td><sub>InvokeHostFunctionOp</sub></td>
<td>

```js
{
  type: 'contractCodeUploaded',
  source: 'GBWC…DXHN',
  wasm: 'AGFz…AAAF',
  wasmHash: '5c55…e46d',
  keyHash: 'a833…f27f'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>contractCodeRemoved</code></sub>
</td>
<td><sub>InvokeHostFunctionOp</sub></td>
<td>

```js
{
  type: 'contractCodeRemoved',
  source: 'GBWC…DXHN',
  wasmHash: '5c55…e46d',
  keyHash: 'a833…f27f'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>contractCreated</code></sub>
</td>
<td><sub>InvokeHostFunctionOp</sub></td>
<td>

```js
{
  type: 'contractCreated',
  source: 'GBWC…DXHN',
  contract: 'CBIH…AZAD',
  kind: 'fromAsset',
  asset: 'ICGVCWUQXIHO-GBD2…FUAC-2'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>contractUpdated</code></sub>
</td>
<td><sub>InvokeHostFunctionOp</sub></td>
<td>

```js
{
  type: 'contractUpdated',
  source: 'GBWC…DXHN',
  contract: 'CBIH…AZAD',
  kind: 'wasm',
  wasmHash: '5c55…e46d',
  prevWasmHash: 'eb94…19ae'

}
```

</td>
</tr>

<tr>
<td>
<sub><code>contractInvoked</code></sub>
</td>
<td><sub>InvokeHostFunctionOp</sub></td>
<td>

```js
{
  type: 'contractInvoked',
  source: 'GBWC…DXHN',
  contract: 'CBIH…AZAD',
  function: 'mint',
  rawArgs: 'AAAA…Ag==',
  depth: 1,
  args: [
    'CDFD…ITT3',
    '1000'
  ]
}
```

</td>
</tr>

<tr>
<td>
<sub><code>contractError</code></sub>
</td>
<td><sub>InvokeHostFunctionOp</sub></td>
<td>

```js
{
  type: 'contractError',
  source: 'GB6V…UIYN',
  contract: 'CBIH…AZAD',
  code: 13,
  details: [
    'trustline entry is missing for account',
    'GB6V…UIYN'
  ]
}
```

</td>
</tr>

<tr>
<td>
<sub><code>contractDataCreated</code></sub>
</td>
<td><sub>InvokeHostFunctionOp</sub></td>
<td>

```js
{
  type: 'contractDataCreated',
  source: 'GC3E…XMJY',
  owner: 'CCM3…OFJX',
  key: 'AAAA…0SQ=',
  value: 'AAAA…AA==',
  durability: 'persistent',
  keyHash: '2177…a56a'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>contractDataUpdated</code></sub>
</td>
<td><sub>InvokeHostFunctionOp</sub></td>
<td>

```js
{
  type: 'contractDataUpdated',
  source: 'GC3E…XMJY',
  owner: 'CCM3…OFJX',
  key: 'AAAAFA==',
  value: 'AAAA…AA==',
  prevValue: 'AAAA…AAA=',
  durability: 'persistent',
  keyHash: '2177…a56a'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>contractDataRemoved</code></sub>
</td>
<td><sub>InvokeHostFunctionOp</sub></td>
<td>

```js
{
  type: 'contractDataRemoved',
  source: 'GC3E…XMJY',
  owner: 'CCM3…OFJX',
  key: 'AAAAFA==',
  prevValue: 'AAAA…AAA=',
  durability: 'instance'
}
```

</td>
</tr>

<tr>
<td>
<sub><code>contractEvent</code></sub>
</td>
<td><sub>InvokeHostFunctionOp</sub></td>
<td>

```js
{
  type: 'contractEvent',
  source: 'GC3E…XMJY',
  contract: 'CCM3…OFJX',
  topics: [
    'mint',
    'GC3E…XMJY',
    'CDFD…ITT3',
    'AMDL:GC3E…XMJY'
  ],
  rawTopics: [
    'AAAA…aW50',
    'AAAA…gLs=',
    'AAAA…JA==',
    'AAAA…AAAA'
  ],
  data: '1000',
  rawData: 'AAAA…A+g='
}
```

</td>
</tr>

<tr>
<td>
<sub><code>contractMetrics</code></sub>
</td>
<td><sub>InvokeHostFunctionOp</sub></td>
<td>

```js
{
  type: 'contractMetrics',
  source: 'GC3E…XMJY',
  contract: 'CCM3…OFJX',
  cpu_insn: 25470499,
  emit_event: 5,
  emit_event_byte: 1176,
  invoke_time_nsecs: 2013675,
  ledger_read_byte: 36624,
  ledger_write_byte: 1028,
  max_emit_event_byte: 328,
  max_rw_code_byte: 16352,
  max_rw_data_byte: 924,
  max_rw_key_byte: 160,
  mem_byte: 10204502,
  read_code_byte: 33508,
  read_data_byte: 3116,
  read_entry: 16,
  read_key_byte: 1244,
  write_code_byte: 0,
  write_data_byte: 1028,
  write_entry: 5,
  write_key_byte: 0,
  fee: {
    nonrefundable: 284210,
    refundable: 100521,
    rent: 100481
  }
}
```

</td>
</tr>

<tr>
<td>
<sub><code>setTtl</code></sub>
</td>
<td><sub>ExtendFootprintTTLOp, RestoreFootprintOp</sub></td>
<td>

```js
{
  type: 'setTtl',
  source: 'GC3E…XMJY',
  owner: 'CDAE…EH7T',
  kind: 'contractData',
  keyHash: '7594…b429',
  ttl: 2873856
}
```

</td>
</tr>

</table>