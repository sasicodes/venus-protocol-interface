/* eslint-disable no-useless-escape */
import React, { useEffect, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import styled from 'styled-components';
import BigNumber from 'bignumber.js';
import { compose } from 'recompose';
import { withRouter } from 'react-router-dom';
import { bindActionCreators } from 'redux';
import { connectAccount, accountActionCreators } from 'core';
import MainLayout from 'containers/Layout/MainLayout';
import CoinInfo from 'components/Vote/CoinInfo';
import VotingWallet from 'components/Vote/VotingWallet';
import VotingPower from 'components/Vote/VotingPower';
import Proposals from 'components/Vote/Proposals';
import { promisify } from 'utilities';
import { Row, Column } from 'components/Basic/Style';
import {
  CONTRACT_XVS_TOKEN_ADDRESS,
  CONTRACT_VBEP_ADDRESS
} from 'utilities/constants';
import { useWeb3React } from '@web3-react/core';
import useRefresh from '../../hooks/useRefresh';
import {
  useComptroller,
  useToken,
  useVaiUnitroller,
  useXvsVaultProxy
} from '../../hooks/useContract';
import useWeb3 from '../../hooks/useWeb3';
import { getVbepContract } from '../../utilities/contractHelpers';

const VoteWrapper = styled.div`
  height: 100%;
`;

function Vote({ history, getProposals }) {
  const [balance, setBalance] = useState(0);
  const [votingWeight, setVotingWeight] = useState('0');
  const [proposals, setProposals] = useState({});
  const [current, setCurrent] = useState(1);
  const [isLoadingProposal, setIsLoadingPropoasl] = useState(false);
  const [earnedBalance, setEarnedBalance] = useState('0.00000000');
  const [vaiMint, setVaiMint] = useState('0.00000000');
  const [delegateAddress, setDelegateAddress] = useState('');
  const [delegateStatus, setDelegateStatus] = useState('');
  const [stakedAmount, setStakedAmount] = useState('');
  const { account } = useWeb3React();
  const { fastRefresh } = useRefresh();
  const xvsTokenContract = useToken('xvs');
  const comptrollerContract = useComptroller();
  const vaiUnitrollerContract = useVaiUnitroller();
  const xvsVaultProxyContract = useXvsVaultProxy();
  const web3 = useWeb3();

  const loadInitialData = useCallback(async () => {
    setIsLoadingPropoasl(true);
    await promisify(getProposals, {
      offset: 0,
      limit: 5
    })
      .then(res => {
        setIsLoadingPropoasl(false);
        setProposals(res.data);
      })
      .catch(() => {
        setIsLoadingPropoasl(false);
      });
  }, [getProposals]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const handleChangePage = (pageNumber, offset, limit) => {
    setCurrent(pageNumber);
    setIsLoadingPropoasl(true);
    promisify(getProposals, {
      offset,
      limit
    })
      .then(res => {
        setProposals(res.data);
        setIsLoadingPropoasl(false);
      })
      .catch(() => {
        setIsLoadingPropoasl(false);
      });
  };

  const updateBalance = async () => {
    if (account) {
      const [currentVotes, balanceTemp, userInfo] = await Promise.all([
        // voting power is calculated from user's amount of XVS staked in the XVS vault
        xvsVaultProxyContract.methods.getCurrentVotes(account).call(),
        xvsTokenContract.methods.balanceOf(account).call(),
        xvsVaultProxyContract.methods
          .getUserInfo(CONTRACT_XVS_TOKEN_ADDRESS, 0, account)
          .call()
      ]);
      setVotingWeight(new BigNumber(currentVotes).div(1e18).toString(10));
      setBalance(
        new BigNumber(balanceTemp)
          .div(1e18)
          .dp(4, 1)
          .toString(10)
      );
      setStakedAmount(userInfo.amount);
    }
  };

  const getVoteInfo = async () => {
    const myAddress = account;
    if (!myAddress) return;

    let [
      venusInitialIndex,
      venusAccrued,
      venusVAIState,
      vaiMinterIndex,
      vaiMinterAmount
    ] = await Promise.all([
      comptrollerContract.methods.venusInitialIndex().call(),
      comptrollerContract.methods.venusAccrued(myAddress).call(),
      vaiUnitrollerContract.methods.venusVAIState().call(),
      vaiUnitrollerContract.methods.venusVAIMinterIndex(myAddress).call(),
      comptrollerContract.methods.mintedVAIs(myAddress).call()
    ]);
    let venusEarned = new BigNumber(0);
    await Promise.all(
      Object.values(CONTRACT_VBEP_ADDRESS).map(async item => {
        const vBepContract = getVbepContract(web3, item.id);
        let [
          supplyState,
          supplierIndex,
          supplierTokens,
          borrowState,
          borrowerIndex,
          borrowBalanceStored,
          borrowIndex
        ] = await Promise.all([
          comptrollerContract.methods.venusSupplyState(item.address).call(),
          comptrollerContract.methods
            .venusSupplierIndex(item.address, myAddress)
            .call(),
          vBepContract.methods.balanceOf(myAddress).call(),
          comptrollerContract.methods.venusBorrowState(item.address).call(),
          comptrollerContract.methods
            .venusBorrowerIndex(item.address, myAddress)
            .call(),
          vBepContract.methods.borrowBalanceStored(myAddress).call(),
          vBepContract.methods.borrowIndex().call()
        ]);
        const supplyIndex = supplyState.index;
        if (+supplierIndex === 0 && +supplyIndex > 0) {
          supplierIndex = venusInitialIndex;
        }
        let deltaIndex = new BigNumber(supplyIndex).minus(supplierIndex);

        const supplierDelta = new BigNumber(supplierTokens)
          .multipliedBy(deltaIndex)
          .dividedBy(1e36);

        venusEarned = venusEarned.plus(supplierDelta);
        if (+borrowerIndex > 0) {
          deltaIndex = new BigNumber(borrowState.index).minus(borrowerIndex);
          const borrowerAmount = new BigNumber(borrowBalanceStored)
            .multipliedBy(1e18)
            .dividedBy(borrowIndex);
          const borrowerDelta = borrowerAmount
            .times(deltaIndex)
            .dividedBy(1e36);
          venusEarned = venusEarned.plus(borrowerDelta);
        }
      })
    );

    venusEarned = venusEarned
      .plus(venusAccrued)
      .dividedBy(1e18)
      .dp(8, 1)
      .toString(10);

    const vaiMintIndex = venusVAIState.index;
    if (+vaiMinterIndex === 0 && +vaiMintIndex > 0) {
      vaiMinterIndex = venusInitialIndex;
    }
    const deltaIndex = new BigNumber(vaiMintIndex).minus(
      new BigNumber(vaiMinterIndex)
    );
    const vaiMinterDelta = new BigNumber(vaiMinterAmount)
      .times(deltaIndex)
      .div(1e54)
      .dp(8, 1)
      .toString(10);
    setEarnedBalance(
      venusEarned && venusEarned !== '0' ? `${venusEarned}` : '0.00000000'
    );
    setVaiMint(
      vaiMinterDelta && vaiMinterDelta !== '0'
        ? `${vaiMinterDelta}`
        : '0.00000000'
    );
  };

  const updateDelegate = async () => {
    if (account) {
      const res = await xvsVaultProxyContract.methods.delegates(account).call();
      setDelegateAddress(res);
      if (res !== '0x0000000000000000000000000000000000000000') {
        setDelegateStatus(res === account ? 'self' : 'delegate');
      } else {
        setDelegateStatus('');
      }
    }
  };

  useEffect(() => {
    getVoteInfo();
    updateBalance();
    updateDelegate();
  }, [fastRefresh, account]);

  return (
    <MainLayout title="Vote">
      <VoteWrapper className="flex">
        <Row>
          <Column xs="12" sm="12" md="12">
            <VotingPower
              history={history}
              stakedAmount={stakedAmount}
              balance={balance !== '0' ? `${balance}` : '0.00000000'}
              delegateAddress={delegateAddress}
              delegateStatus={delegateStatus}
              power={
                votingWeight !== '0'
                  ? `${new BigNumber(votingWeight).dp(8, 1).toString(10)}`
                  : '0.00000000'
              }
            />
          </Column>
          <Column xs="12" sm="12" md="5">
            <Row>
              <Column xs="12">
                <CoinInfo
                  balance={balance !== '0' ? `${balance}` : '0.00000000'}
                  address={account || ''}
                />
              </Column>
              <Column xs="12">
                <VotingWallet
                  balance={balance !== '0' ? `${balance}` : '0.00000000'}
                  earnedBalance={earnedBalance}
                  vaiMint={vaiMint}
                  delegateAddress={delegateAddress}
                  delegateStatus={delegateStatus}
                />
              </Column>
            </Row>
          </Column>
          <Column xs="12" sm="12" md="7">
            <Row>
              <Column xs="12">
                <Proposals
                  address={account || ''}
                  isLoadingProposal={isLoadingProposal}
                  pageNumber={current}
                  proposals={proposals.result}
                  total={proposals.total || 0}
                  votingWeight={votingWeight}
                  onChangePage={handleChangePage}
                />
              </Column>
            </Row>
          </Column>
        </Row>
      </VoteWrapper>
    </MainLayout>
  );
}

Vote.propTypes = {
  getProposals: PropTypes.func.isRequired,
  history: PropTypes.object.isRequired
};

Vote.defaultProps = {};

const mapStateToProps = ({ account }) => ({
  settings: account.setting
});

const mapDispatchToProps = dispatch => {
  const { getProposals, setSetting } = accountActionCreators;

  return bindActionCreators(
    {
      getProposals,
      setSetting
    },
    dispatch
  );
};

export default compose(
  withRouter,
  connectAccount(mapStateToProps, mapDispatchToProps)
)(Vote);
