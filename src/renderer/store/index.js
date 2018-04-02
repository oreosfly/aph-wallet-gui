import Vue from 'vue';
import Vuex from 'vuex';
import * as actions from './actions';
import * as getters from './getters';
import * as mutations from './mutations';

Vue.use(Vuex);

const state = {
  activeTransaction: null,
  holdings: [],
  portfolio: {},
  recentTransactions: [],
  showAddTokenModal: false,
  showSendAddressModal: false,
  showPriceTile: true,
  statsToken: null,
};

const store = new Vuex.Store({
  actions,
  getters,
  mutations,
  state,
});

export {
  actions,
  getters,
  mutations,
  state,
  store,
};
