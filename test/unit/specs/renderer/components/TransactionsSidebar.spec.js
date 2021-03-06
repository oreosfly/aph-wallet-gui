import Vue from 'vue';
import sinon from 'sinon';

import TransactionsSidebar from '@/components/TransactionsSidebar';
import utils from './utils';

const RECENT_TRANSACTIONS = [
  {
    from: 'from',
    to: 'to',
    value: 1,
  },
  {
    from: 'from',
    to: 'to',
    value: -1,
  },
];
const COMPUTED_TRANSACTIONS = [
  {
    address: 'from',
    from: 'from',
    to: 'to',
    value: 1,
  },
  {
    address: 'to',
    from: 'from',
    to: 'to',
    value: -1,
  },
];

let loadTransactions;
let wrapper;

describe('TransactionsSidebar.vue', () => {
  beforeEach(() => {
    loadTransactions = sinon.spy();
    Vue.prototype.$constants.intervals.TRANSACTIONS_POLLING = 5;

    const customState = {
      recentTransactions: RECENT_TRANSACTIONS,
    };

    const opts = {
      methods: { loadTransactions },
      stubs: {
        'aph-icon': require('@/components/Icon.vue').default,
        'aph-simple-transactions': '<div />',
      },
    };

    wrapper = utils.mount(TransactionsSidebar, opts, customState);
  });

  context('always', () => {
    beforeEach((done) => {
      setTimeout(done, 5);
    });

    it('should render with correctly formatted data', () => {
      expect(wrapper.find('h1.underlined').text()).contains('Recent Transactions');
      expect(wrapper.contains('#transactions-sidebar')).to.be.true();
    });

    it('should properly compute computed properties', () => {
      expect(wrapper.vm.transactions).to.eql(COMPUTED_TRANSACTIONS);
    });

    it('should fetch transactions', () => {
      expect(loadTransactions).to.have.been.calledThrice();
    });
  });

  context('the user clicks the toggle to open', () => {
    it('should show the correct icon', () => {
      wrapper.find('.toggle').trigger('click');

      expect(wrapper.contains('.icon.double-arrow-right')).to.be.true();
    });
  });

  context('the user clicks the toggle to close', () => {
    it('should show the correct icon', () => {
      wrapper.setData({ open: true });
      wrapper.find('.toggle').trigger('click');

      expect(wrapper.contains('.icon.history')).to.be.true();
    });
  });

  context('the component is destroyed', () => {
    it('should clear the interval', () => {
      window.clearInterval = sinon.spy();
      wrapper.destroy();

      expect(window.clearInterval).to.have.been.calledOnce();
    });
  });
});
