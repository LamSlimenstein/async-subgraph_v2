import { BigInt, log } from "@graphprotocol/graph-ts";
import {
  Contract,
  Approval,
  ApprovalForAll,
  ArtistSecondSalePercentUpdated,
  BidProposed,
  BidWithdrawn,
  BuyPriceSet,
  ControlLeverUpdated,
  CreatorWhitelisted,
  PermissionUpdated,
  PlatformAddressUpdated,
  PlatformSalePercentageUpdated,
  TokenSale,
  Transfer,
} from "../generated/Contract/Contract";
import {
  GlobalState,
  Bid,
  Token,
  Sale,
  TokenControlLever,
  User,
  LayerUpdate,
  TokenController,
} from "../generated/schema";
import {
  saveEventToStateChange,
  getOrInitialiseGlobalState,
  createTokensFromMasterTokenId,
  populateTokenUniqueCreators,
  getPermissionedAddress,
  getOrInitialiseToken,
  refreshGlobalState,
  createOrFetchUserString,
  linkMasterAndControllers,
} from "./util";

export function handleArtistSecondSalePercentUpdated(
  event: ArtistSecondSalePercentUpdated
): void {
  let newSecondPercentage = event.params.artistSecondPercentage;
  let asyncContract = Contract.bind(event.address);
  let globalState = getOrInitialiseGlobalState(asyncContract);

  globalState.artistSecondSalePercentage = newSecondPercentage;
  globalState.save();
}

export function handleBidProposed(event: BidProposed): void {
  let txTimestamp = event.block.timestamp;
  let blockNumber = event.block.number;
  let txHash = event.transaction.hash;
  let tokenId = event.params.tokenId;
  let bidAmount = event.params.bidAmount;
  let bidder = event.params.bidder;

  let asyncContract = Contract.bind(event.address);
  // Hooks to update state from contract
  let globalState = getOrInitialiseGlobalState(asyncContract);
  globalState.save();

  let token = getOrInitialiseToken(asyncContract, tokenId);
  let user = createOrFetchUserString(bidder.toHexString());
  if (token == null) {
    log.warning("Bid on token that doesn't exist", []);
  } else {
    let bid = new Bid(tokenId.toString() + "-" + txHash.toHex());
    bid.tokenDetails = tokenId.toString();
    bid.bidAmount = bidAmount;
    bid.bidder = user.id;
    bid.bidTimestamp = txTimestamp;
    bid.bidActive = true;
    bid.bidAccepted = false;

    let oldBid = Bid.load(token.currentBid);
    if (oldBid != null) {
      oldBid.bidActive = false;
      oldBid.save();
    }

    user.bids = user.bids.concat([bid.id]);
    token.currentBid = bid.id;

    user.save();
    token.save();
    bid.save();
    linkMasterAndControllers(tokenId);
  }
}

export function handleBidWithdrawn(event: BidWithdrawn): void {
  let txTimestamp = event.block.timestamp;
  let blockNumber = event.block.number;
  let txHash = event.transaction.hash;
  let tokenId = event.params.tokenId;

  let asyncContract = Contract.bind(event.address);
  refreshGlobalState(asyncContract);

  let token = getOrInitialiseToken(asyncContract, tokenId);
  if (token == null) {
    log.critical("Token should be defined", []);
  } else {
    let bid = Bid.load(token.currentBid);
    if (bid == null) {
      log.warning("Bid should be defined", []);
    } else {
      bid.bidActive = false;
      bid.BidWithdrawnTimestamp = txTimestamp;
      bid.save();
    }
  }
}

export function handleBuyPriceSet(event: BuyPriceSet): void {
  let txTimestamp = event.block.timestamp;
  let blockNumber = event.block.number;
  let txHash = event.transaction.hash;
  let tokenId = event.params.tokenId;
  let buyPrice = event.params.price;

  let asyncContract = Contract.bind(event.address);
  // Hooks to update state from contract
  refreshGlobalState(asyncContract);

  let token = getOrInitialiseToken(asyncContract, tokenId);
  if (token == null) {
    log.warning("Token should be defined", []);
  } else {
    token.currentBuyPrice = buyPrice;
    token.save();
    linkMasterAndControllers(tokenId);
  }
}

export function handleControlLeverUpdated(event: ControlLeverUpdated): void {
  let txTimestamp = event.block.timestamp;
  let blockNumber = event.block.number;
  let txHash = event.transaction.hash;
  let gasPrice = event.transaction.gasPrice;
  let gasUsed = event.transaction.gasUsed;
  let tokenId = event.params.tokenId;
  let priorityTip = event.params.priorityTip;
  let numRemainingUpdates = event.params.numRemainingUpdates;
  let leverIds = event.params.leverIds;
  let previousValues = event.params.previousValues;
  let updatedValues = event.params.updatedValues;

  let asyncContract = Contract.bind(event.address);
  refreshGlobalState(asyncContract);

  let token = getOrInitialiseToken(asyncContract, tokenId);
  if (token == null) {
    log.critical("Token should be defined", []);
  }

  let controllerToken = TokenController.load(
    tokenId.toString() + "-Controller"
  );
  let newNumberOfUpdates = controllerToken.numberOfUpdates.plus(
    BigInt.fromI32(1)
  );
  controllerToken.numberOfUpdates = newNumberOfUpdates;
  controllerToken.numRemainingUpdates = numRemainingUpdates;

  let layerUpdate = new LayerUpdate(
    tokenId.toString() + "-" + newNumberOfUpdates.toString()
  );
  layerUpdate.updateNumber = newNumberOfUpdates;
  layerUpdate.gasPrice = gasPrice;
  layerUpdate.gasUsed = gasUsed;
  layerUpdate.costInWei = gasPrice.times(gasUsed);
  layerUpdate.priorityTip = priorityTip;
  layerUpdate.layer = controllerToken.id;
  layerUpdate.leversUpdated = [];

  for (let i = 0; i < previousValues.length; i++) {
    let lever = TokenControlLever.load(
      tokenId.toString() + "-" + leverIds[i].toString()
    );
    lever.previousValue = previousValues[i];
    lever.currentValue = updatedValues[i];
    lever.latestUpdate = layerUpdate.id;
    lever.numberOfUpdates = lever.numberOfUpdates.plus(BigInt.fromI32(1));
    lever.save();
    layerUpdate.leversUpdated = layerUpdate.leversUpdated.concat([lever.id]);
  }

  layerUpdate.save();
  controllerToken.save();
}

export function handleCreatorWhitelisted(event: CreatorWhitelisted): void {
  //log.warning("Whitelist", []);
  let txTimestamp = event.block.timestamp;
  let blockNumber = event.block.number;
  let txHash = event.transaction.hash;
  let tokenId = event.params.tokenId;
  let layerCount = event.params.layerCount;
  let creator = event.params.creator;
  let artistAddressString = creator.toHex();

  let asyncContract = Contract.bind(event.address);
  let globalState = getOrInitialiseGlobalState(asyncContract);

  globalState.latestMasterTokenId = tokenId;
  globalState.currentExpectedTokenSupply = tokenId
    .plus(layerCount)
    .plus(BigInt.fromI32(1));

  globalState.save();

  createTokensFromMasterTokenId(asyncContract, tokenId, layerCount);
}

export function handlePermissionUpdated(event: PermissionUpdated): void {
  let txTimestamp = event.block.timestamp;
  let blockNumber = event.block.number;
  let txHash = event.transaction.hash;
  let tokenId = event.params.tokenId;
  let addressOfGranter = event.params.tokenOwner;
  let permissioned = event.params.permissioned;

  let asyncContract = Contract.bind(event.address);
  // Hooks to update state from contract
  let globalState = getOrInitialiseGlobalState(asyncContract);
  globalState.save();

  let token = getOrInitialiseToken(asyncContract, tokenId);
  if (token == null) {
    log.critical("Token should be defined", []);
  }

  // Only update this if called by current token owner!
  if (addressOfGranter.toHex() == token.owner) {
    token.permissionedAddress = permissioned;
    token.save();
  }
  linkMasterAndControllers(tokenId);
}

export function handlePlatformAddressUpdated(
  event: PlatformAddressUpdated
): void {
  let newPlatformAddress = event.params.platformAddress;
  let asyncContract = Contract.bind(event.address);
  let globalState = getOrInitialiseGlobalState(asyncContract);

  globalState.platformAddress = newPlatformAddress;
  globalState.save();
}

export function handlePlatformSalePercentageUpdated(
  event: PlatformSalePercentageUpdated
): void {
  let txTimestamp = event.block.timestamp;
  let blockNumber = event.block.number;
  let txHash = event.transaction.hash;
  let tokenId = event.params.tokenId;
  let platformFirstPercentage = event.params.platformFirstPercentage;
  let platformSecondPercentage = event.params.platformSecondPercentage;

  let asyncContract = Contract.bind(event.address);
  // Hooks to update state from contract
  refreshGlobalState(asyncContract);

  let token = getOrInitialiseToken(asyncContract, tokenId);
  if (token == null) {
    log.critical("Token should be defined", []);
  }
  token.platformFirstSalePercentage = platformFirstPercentage;
  token.platformSecondSalePercentage = platformSecondPercentage;
  token.save();
  linkMasterAndControllers(tokenId);
}

export function handleTokenSale(event: TokenSale): void {
  let txTimestamp = event.block.timestamp;
  let blockNumber = event.block.number;
  let txHash = event.transaction.hash;
  let tokenId = event.params.tokenId;
  let salePrice = event.params.salePrice;
  let _buyer = event.params.buyer;

  let asyncContract = Contract.bind(event.address);
  // Hooks to update state from contract
  refreshGlobalState(asyncContract);

  let buyer = createOrFetchUserString(_buyer.toHexString());
  let token = getOrInitialiseToken(asyncContract, tokenId);
  let seller = User.load(token.owner);

  if (token == null) {
    log.critical("Token should be defined", []);
  }
  let tokenSaleNumber = token.numberOfSales.plus(BigInt.fromI32(1));

  let sale = new Sale(tokenId.toString() + "-" + tokenSaleNumber.toString());
  sale.tokenDetails = token.id;
  sale.buyer = buyer.id;
  sale.seller = seller.id;
  sale.salePrice = salePrice;
  sale.saleTimestamp = txTimestamp;
  sale.tokenSaleNumber = tokenSaleNumber;
  sale.isBidSale = false;

  let bid = Bid.load(token.currentBid);
  if (bid == null) {
    log.info("No bid exists", []);
  } else {
    if (bid.bidAmount.equals(salePrice) && _buyer.toHexString() == bid.bidder) {
      bid.bidAccepted = true;
      sale.isBidSale = true;
      sale.bidDetails = bid.id;
    }
    bid.bidActive = false;
    bid.save();
  }

  token.owner = buyer.id;
  token.lastSalePrice = salePrice;
  token.currentBuyPrice = BigInt.fromI32(0);
  token.numberOfSales = token.numberOfSales.plus(BigInt.fromI32(1));
  token.tokenDidHaveFirstSale = true;
  token.currentBid = null;
  // If the token get bought back and was previously permissioned, this permission remains!
  let possiblePermissionedAddress = getPermissionedAddress(
    asyncContract,
    tokenId,
    _buyer
  );
  token.permissionedAddress = possiblePermissionedAddress;

  // If they buy this back, will it be a duplicate
  if (token.isMaster) {
    buyer.ownedMasters = buyer.ownedMasters.concat([token.id + "-Master"]);
  } else {
    buyer.ownerControllers = buyer.ownerControllers.concat([
      token.id + "-Controller",
    ]);
  }

  buyer.buys = buyer.buys.concat([sale.id]);
  seller.sells = seller.sells.concat([sale.id]);

  buyer.save();
  seller.save();
  sale.save();
  token.save();
  linkMasterAndControllers(tokenId);
}

export function handleApproval(event: Approval): void {
  // let owner = event.params.owner;
  // let ownerString = owner.toHex();
  // let txTimestamp = event.block.timestamp;
  // let blockNumber = event.block.number;
  // let eventParamValues: Array<string> = [ownerString];
  // let eventParamNames: Array<string> = ["owner"];
  // let eventParamTypes: Array<string> = ["address"];
  // saveEventToStateChange(
  //   event.transaction.hash,
  //   txTimestamp,
  //   blockNumber,
  //   "Approval",
  //   eventParamValues,
  //   eventParamNames,
  //   eventParamTypes,
  //   [],
  //   [],
  //   0
  // );
}

export function handleApprovalForAll(event: ApprovalForAll): void {}

export function handleTransfer(event: Transfer): void {}
