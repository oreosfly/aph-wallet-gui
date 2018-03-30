import {
  wallet,
  api,
  rpc,
  u,
} from '@cityofzion/neon-js';
import BigNumber from 'bignumber.js';
import wallets from './wallets';
import tokens from './tokens';
import valuation from './valuation';

const toBigNumber = value => new BigNumber(String(value));

const neoAssetId = '0xc56f33fc6ecfcd0c225c4ab356fee59390af8560be0e930faebe74a6daff7c9b';
const gasAssetId = '0x602c79718b16e442de58778e148d0b1084e3b2dffd5de6b7b16cee7969282de7';

// const network = 'MainNet';
// const rpcEndpoint = 'http://seed1.aphelion-neo.com:10332'; // todo, multiple options for rpc endpoints
/* const nep5TokenIds = [
  'a0777c3ce2b169d4a23bcba4565e3225a0122d95',
]; */

const network = 'TestNet';
const rpcEndpoint = 'http://test3.cityofzion.io:8880'; // todo, an app preference to move between test and main net
const aphApiBaseUrl = 'http://localhost:62433/api';
let lastClaimSent;

export default {
  /**
   * @param {String} passphrase
   * @param {String} passphraseConfirm
   * @return Promise
   *
   * Response passed to Promise ideally looks like this:
   *  {String} encrypted_key
   *  {String} encrypted_private_key_qr
   *  {String} passhrase
   *  {String} private_key
   *  {String} public_address
   *  {String} public_address_qr
   */
  createWallet(name, passphrase, passphraseConfirm) {
    return new Promise((resolve, reject) => {
      // TODO: abstract validation
      if (wallets.walletExists(name)) {
        return reject(`Wallet with name '${name}' already exists!`);
      }

      if (passphrase !== passphraseConfirm) {
        return reject('Passphrases do not match');
      } else if (passphrase.length < 4) {
        return reject('Please choose a longer passphrase');
      }

      try {
        const account = new wallet.Account(wallet.generatePrivateKey());
        const encryptedWIF = wallet.encrypt(account.WIF, passphrase);

        account.label = name;
        wallets.add(name, {
          label: name,
          encryptedWIF,
          address: account.address,
          scriptHash: account.scriptHash,
        });

        wallets.openSavedWallet(name, passphrase);
        return resolve(_.merge(account, { encryptedWIF, passphrase }));
      } catch (e) {
        return reject('An error occured while trying to generate a new wallet.');
      }
    });
  },

  /**
   * Fetch address's recent transactions.
   *
   * @param {String} address
   * @return Promise
   *
   *  {String} hash
   *  {String} block_index
   *  {String} symbol
   *  {String} amount
   *  {String} block_time
   */
  fetchRecentTransactions(address) {
    return new Promise((resolve, reject) => {
      try {
        return api.neoscan.getTransactionHistory(network, address)
          .then((res) => {
            this.fetchNEP5Transfers(address)
              .then((nep5) => {
                const splitTransactions = [];
                nep5.data.transfers.forEach((t) => {
                  res.push({
                    txid: t.transactionHash.replace('0x', ''),
                    symbol: t.symbol,
                    amount: t.received - t.sent,
                    block_index: t.blockIndex,
                    block_time: t.blockTime,
                    isNep5: true,
                    vin: [{
                      address: t.fromAddress,
                      symbol: t.symbol,
                      value: Math.abs(t.received - t.sent),
                    }],
                    vout: [{
                      address: t.toAddress,
                      symbol: t.symbol,
                      value: Math.abs(t.received - t.sent),
                    }],
                  });
                });

                const promises = [];
                res.forEach((t) => {
                  promises.push(this.fetchTransactionDetails(t.txid)
                    .then((transactionDetails) => {
                      if (t.isNep5 !== true) {
                        let outNEO = new BigNumber(0);
                        let outGAS = new BigNumber(0);

                        transactionDetails.vin.forEach((i) => {
                          if (i.address === address && i.symbol === 'NEO') {
                            outNEO = outNEO.plus(i.value);
                          }
                          if (i.address === address && i.symbol === 'GAS') {
                            outGAS = outGAS.plus(i.value);
                          }
                        });

                        let inNEO = new BigNumber(0);
                        let inGAS = new BigNumber(0);
                        transactionDetails.vout.forEach((o) => {
                          if (o.address === address && o.symbol === 'NEO') {
                            inNEO = inNEO.plus(o.value);
                          }
                          if (o.address === address && o.symbol === 'GAS') {
                            inGAS = inGAS.plus(o.value);
                          }
                        });

                        const neoChange = inNEO.minus(outNEO);
                        const gasChange = inGAS.minus(outGAS);
                        if (neoChange.isZero() === false) {
                          splitTransactions.push({
                            hash: t.txid,
                            block_index: transactionDetails.block,
                            symbol: 'NEO',
                            amount: neoChange,
                            block_time: transactionDetails.blocktime,
                            details: transactionDetails,
                            isNep5: false,
                          });
                        }

                        if (gasChange.isZero() === false) {
                          splitTransactions.push({
                            hash: t.txid,
                            block_index: transactionDetails.block,
                            symbol: 'GAS',
                            amount: gasChange,
                            block_time: transactionDetails.blocktime,
                            details: transactionDetails,
                            isNep5: false,
                          });
                        }
                      } else {
                        transactionDetails.vout = t.vout;
                        transactionDetails.vin = t.vin;
                        splitTransactions.push({
                          hash: t.txid,
                          block_index: transactionDetails.block,
                          symbol: t.symbol,
                          amount: t.amount,
                          block_time: transactionDetails.blocktime,
                          details: transactionDetails,
                        });
                      }
                    }));
                });

                Promise.all(promises)
                  .then(() => resolve(this._sortRecentTransactions(splitTransactions)))
                  .catch(e => reject(e));
              })
              .catch((e) => {
                console.log(e);
              });
          })
          .catch(e => console.log(e));
      } catch (e) {
        return reject(e);
      }
    });
  },

  /**
   * Fetches transaction details for the given hash
   *
   * @param string hash
   * @return Promise
   *
   *  {String} txid
   *  {Float} net_fee
   *  {Float} sys_fee
   *  {Number} block
   *  {Number} size
   *  {Number} confirmations
   *  {Array} vin
   *  {Array} vout
   *  {Boolean} confirmed
   *  {Integer} blocktime
   */
  fetchTransactionDetails(hash) {
    return new Promise((resolve, reject) => {
      try {
        const client = rpc.default.create.rpcClient(rpcEndpoint);

        return client.getBlockCount()
          .then((blockCount) => {
            client.getRawTransaction(hash, 1)
              .then((transaction) => {
                transaction.currentBlockHeight = blockCount;
                if (transaction.confirmations > 0) {
                  transaction.confirmed = true;
                  transaction.block = blockCount - transaction.confirmations;
                } else {
                  transaction.confirmed = false;
                }


                // set output symbols based on asset ids
                transaction.vout.forEach((output) => {
                  if (output.asset === neoAssetId) {
                    output.symbol = 'NEO';
                  } else if (output.asset === gasAssetId) {
                    output.symbol = 'GAS';
                  }
                });

                // pull information for inputs from their previous outputs
                const inputPromises = [];
                transaction.vin.forEach((input) => {
                  inputPromises.push(client.getRawTransaction(input.txid, 1)
                    .then((inputTransaction) => {
                      const inputSource = inputTransaction.vout[input.vout];
                      if (inputSource.asset === neoAssetId) {
                        input.symbol = 'NEO';
                      } else if (inputSource.asset === gasAssetId) {
                        input.symbol = 'GAS';
                      }
                      input.address = inputSource.address;
                      input.value = inputSource.value;
                    })
                    .catch(e => reject(e)));
                });

                Promise.all(inputPromises)
                  .then(() => resolve(transaction))
                  .catch(e => reject(e));
              })
              .catch(e => reject(e));
          })
          .catch(e => reject(e));
      } catch (e) {
        return reject(e);
      }
    });
  },


  /**
   * Fetches holdings...
   *
   * @param {String} address
   * @return Promise
   *
   * Response passed to Promise ideally looks like this:
   *    {Float} value
   *    {String} icon_url
   *    {String} name
   *    {String} symbol
   */
  fetchHoldings(address, restrictToSymbol) {
    return new Promise((resolve, reject) => {
      try {
        const client = rpc.default.create.rpcClient(rpcEndpoint);
        return client.query({ method: 'getaccountstate', params: [address] })
          .then((res) => {
            const holdings = [];
            const promises = [];

            res.result.balances.forEach((b) => {
              const h = {
                asset: b.asset,
                balance: b.value,
                symbol: b.asset === neoAssetId ? 'NEO' : 'GAS',
                name: b.asset === neoAssetId ? 'NEO' : 'GAS',
                isNep5: false,
              };
              if (restrictToSymbol && h.symbol !== restrictToSymbol) {
                return;
              }
              if (h.symbol === 'NEO') {
                promises.push(api.getMaxClaimAmountFrom({
                  net: network,
                  address: wallets.getCurrentWallet().address,
                  privateKey: wallets.getCurrentWallet().privateKey,
                }, api.neoscan)
                  .then((res) => {
                    h.availableToClaim = toBigNumber(res).toString();
                  })
                  .catch((e) => {
                    console.log(e);
                  }));
              }
              holdings.push(h);
            });

            tokens.getAllAsArray().forEach((nep5) => {
              promises.push(this.fetchNEP5Balance(address, nep5.assetId)
                .then((val) => {
                  if (val.balance > 0 || nep5.isCustom === true) {
                    const h = {
                      asset: nep5.assetId,
                      balance: val.balance,
                      symbol: val.symbol,
                      name: val.name,
                      isNep5: true,
                    };

                    if (restrictToSymbol && h.symbol !== restrictToSymbol) {
                      return;
                    }

                    holdings.push(h);
                  }
                })
                .catch((e) => {
                  console.log(e);
                  reject(e);
                }));
            });

            return Promise.all(promises)
              .then(() => {
                const valuationsPromises = [];
                holdings.forEach((h) => {
                  valuationsPromises.push(valuation.getValuation(h.symbol)
                    .then((val) => {
                      h.totalSupply = val.total_supply;
                      h.marketCap = val.market_cap_usd;
                      h.change24hrPercent = val.percent_change_24h;
                      h.unitValue = val.price_usd;
                      h.unitValue24hrAgo = h.unitValue / (1 + (h.change24hrPercent / 100.0));
                      h.change24hrValue = (h.unitValue * h.balance)
                        - (h.unitValue24hrAgo * h.balance);
                      h.totalValue = h.unitValue * h.balance;
                    })
                    .catch((e) => {
                      console.log(e);
                    }));
                });

                return Promise.all(valuationsPromises)
                  .then(() => {
                    const res = { };

                    res.holdings = holdings.sort((a, b) => {
                      if (a.symbol > b.symbol) {
                        return 1;
                      }
                      return -1;
                    });

                    res.totalBalance = 0;
                    res.change24hrValue = 0;
                    holdings.forEach((h) => {
                      res.totalBalance += h.totalValue;
                      res.change24hrValue += h.change24hrValue;
                    });
                    res.change24hrPercent = Math.round(10000 * (res.change24hrValue
                      / (res.totalBalance - res.change24hrValue))) / 100.0;
                    resolve(res);
                  })
                  .catch(e => reject(e));
              })
              .catch(e => reject(e));
          })
          .catch(e => reject(e));
      } catch (e) {
        return reject(e);
      }
    });
  },

  fetchNEP5Tokens() {
    return new Promise((resolve, reject) => {
      try {
        const defaultList = [{
          symbol: 'APH',
          assetId: '591eedcd379a8981edeefe04ef26207e1391904a',
          isCustom: true, // always show even if 0 balance
        }];

        defaultList.forEach((t) => {
          tokens.add(t.symbol, t);
        });

        try {
          return axios.get(`${aphApiBaseUrl}/tokens`)
            .then((res) => {
              res.data.tokens.forEach((t) => {
                tokens.add(t.symbol, {
                  symbol: t.symbol,
                  assetId: t.scriptHash.replace('0x', ''),
                  isCustom: false,
                });
              });
            })
            .catch((e) => {
              console.log(e);
            });
        } catch (e) {
          return reject(e);
        }
      } catch (e) {
        return reject(e);
      }
    });
  },

  fetchNEP5Balance(address, assetId) {
    return new Promise((resolve) => {
      try {
        return api.nep5.getToken(rpcEndpoint, assetId, address)
          .then((token) => {
            resolve({
              name: token.name,
              symbol: token.symbol,
              decimals: token.decimals,
              totalSupply: token.totalSupply,
              balance: token.balance,
            });
          })
          .catch((e) => {
            console.log(e);
            resolve({ balance: 0 });
          });
      } catch (e) {
        console.log(e);
        return resolve({ balance: 0 });
      }
    });
  },

  fetchNEP5Transfers(address) {
    return new Promise((resolve) => {
      try {
        return axios.get(`${aphApiBaseUrl}/transfers/${address}`)
          .then((res) => {
            resolve(res);
          })
          .catch((e) => {
            console.log(e);
            resolve({
              data: {
                transfers: [],
              },
            });
          });
      } catch (e) {
        return resolve({
          data: {
            transfers: [],
          },
        });
      }
    });
  },

  /**
   * @return Promise
   */
  sendFunds(toAddress, assetId, amount, isNep5) {
    return new Promise((resolve, reject) => {
      try {
        let sendPromise = null;
        toAddress = toAddress.trim();
        if (isNep5 === false) {
          if (assetId === neoAssetId) {
            sendPromise = this.sendSystemAsset(toAddress, amount, 0);
          } else if (assetId === gasAssetId) {
            sendPromise = this.sendSystemAsset(toAddress, 0, amount);
          } else {
            return reject('Invalid system asset id');
          }
        } else if (isNep5 === true) {
          sendPromise = this.sendNep5Transfer(toAddress, assetId, amount);
        }

        if (!sendPromise) {
          return reject('Unable to send transaction.');
        }

        sendPromise
          .then((res) => {
            if (!res) {
              console.log('Failed to create transaction.');
              return;
            }
            console.log(`Transaction Hash: ${res.tx.hash} Sent, waiting for confirmation.`);
            this.monitorTransactionConfirmation(res.tx.hash)
              .then(() => {
                return resolve(res.tx);
              })
              .catch((e) => {
                console.log(e);
              });
          })
          .catch((e) => {
            console.log(e);
          });
        return sendPromise;
      } catch (e) {
        return reject(e);
      }
    });
  },

  sendSystemAsset(toAddress, neoAmount, gasAmount) {
    const intentAmounts = {};
    if (neoAmount > 0) {
      intentAmounts.NEO = neoAmount;
    }
    if (gasAmount > 0) {
      intentAmounts.GAS = gasAmount;
    }

    return api.neoscan.getBalance(network, wallets.getCurrentWallet().address)
      .then((balance) => {
        const config = {
          net: network,
          address: wallets.getCurrentWallet().address,
          privateKey: wallets.getCurrentWallet().privateKey,
          balance,
          intents: api.makeIntent(intentAmounts, toAddress),
        };
        return api.sendAsset(config)
          .then(res => res)
          .catch((e) => {
            console.log(e);
          });
      })
      .catch((e) => {
        console.log(e);
      });
  },

  sendNep5Transfer(toAddress, assetId, amount) {
    const config = {
      net: network,
      account: new wallet.Account(wallets.getCurrentWallet().wif),
      intents: api.makeIntent({ GAS: 0.00000001 }, wallets.getCurrentWallet().address),
      script: {
        scriptHash: assetId,
        operation: 'transfer',
        args: [
          u.reverseHex(wallet.getScriptHashFromAddress(wallets.getCurrentWallet().address)),
          u.reverseHex(wallet.getScriptHashFromAddress(toAddress)),
          new u.Fixed8(amount).toReverseHex(),
        ],
      },
      gas: 0,
    };

    return api.doInvoke(config)
      .then(res => res)
      .catch((e) => {
        console.log(e);
      });
  },

  monitorTransactionConfirmation(hash) {
    return new Promise((resolve, reject) => {
      try {
        const interval = setInterval(() => {
          this.fetchTransactionDetails(hash)
            .then((res) => {
              if (res.confirmed === true) {
                console.log(`TX: ${hash} CONFIRMED`);
                clearInterval(interval);
                resolve(res);
              }
              return res;
            })
            .catch(e => console.log(e));
        }, 5000);
        return null;
      } catch (e) {
        return reject(e);
      }
    });
  },

  claimGas() {
    if (new Date() - lastClaimSent < 5 * 60 * 1000) { // 5 minutes ago
      console.log('May only claim GAS once every 5 minutes.');
      return null;
    }

    lastClaimSent = new Date();
    return this.fetchHoldings(wallets.getCurrentWallet().address, 'NEO')
      .then((h) => {
        if (h.holdings.length === 0 || h.holdings[0].balance <= 0) {
          console.log('No NEO to claim from.');
          return;
        }

        const neoAmount = h.holdings[0].balance;
        console.log(`Transfering ${neoAmount} to self.`);
        // send neo to ourself to make all gas available for claim
        this.sendFunds(wallets.getCurrentWallet().address, neoAssetId, neoAmount, false)
          .then(() => {
            const config = {
              net: network,
              address: wallets.getCurrentWallet().address,
              privateKey: wallets.getCurrentWallet().privateKey,
            };

            // send the claim gas
            api.claimGas(config)
              .then((res) => {
                console.log('Gas Claim Sent.');
                h.availableToClaim = 0;
                return res;
              })
              .catch((e) => {
                console.log(e);
              });
          })
          .catch((e) => {
            console.log(e);
          });
      })
      .catch((e) => {
        console.log(e);
      });
  },

  _sortRecentTransactions(transactions) {
    return transactions.sort((a, b) => {
      if (a.block_time < b.block_time) {
        return 1;
      }

      if (a.block_time > b.block_time) {
        return -1;
      }

      return 0;
    });
  },

};
