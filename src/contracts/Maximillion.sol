pragma solidity ^0.5.16;

import "./xkcc.sol";

/**
 * @title 0xlend's Maximillion Contract
 * @author 0xlend
 */
contract Maximillion {
    /**
     * @notice The default xkcc market to repay in
     */
    xkcc public xkcc;

    /**
     * @notice Construct a Maximillion to repay max in a xkcc market
     */
    constructor(xkcc xkcc_) public {
        xkcc = xkcc_;
    }

    /**
     * @notice msg.sender sends Ether to repay an account's borrow in the xkcc market
     * @dev The provided Ether is applied towards the borrow balance, any excess is refunded
     * @param borrower The address of the borrower account to repay on behalf of
     */
    function repayBehalf(address borrower) public payable {
        repayBehalfExplicit(borrower, xkcc);
    }

    /**
     * @notice msg.sender sends Ether to repay an account's borrow in a xkcc market
     * @dev The provided Ether is applied towards the borrow balance, any excess is refunded
     * @param borrower The address of the borrower account to repay on behalf of
     * @param xkcc_ The address of the xkcc contract to repay in
     */
    function repayBehalfExplicit(address borrower, xkcc xkcc_) public payable {
        uint received = msg.value;
        uint borrows = xkcc_.borrowBalanceCurrent(borrower);
        if (received > borrows) {
            xkcc_.repayBorrowBehalf.value(borrows)(borrower);
            msg.sender.transfer(received - borrows);
        } else {
            xkcc_.repayBorrowBehalf.value(received)(borrower);
        }
    }
}
