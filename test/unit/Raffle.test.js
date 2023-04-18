const { network, getNamedAccounts, deployments, ethers } = require("hardhat")
const {
    developmentChains,
    networkConfig,
} = require("../../helper-hardhat-config")
const { assert, expect } = require("chai")
const chainId = network.config.chainId

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit Tests", () => {
          let raffle,
              vrfCoordinatorV2Mock,
              raffleEntranceFee,
              deployer,
              interval

          beforeEach(async () => {
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["all"])
              raffle = await ethers.getContract("Raffle", deployer)
              vrfCoordinatorV2Mock = await ethers.getContract(
                  "VRFCoordinatorV2Mock",
                  deployer
              )
              raffleEntranceFee = await raffle.getEntranceFee()
              interval = await raffle.getInterval()
          })
          describe("constructor", () => {
              it("Initializes the raffle correctly", async () => {
                  const raffleState = await raffle.getRaffleState()
                  assert.equal(raffleState.toString(), "0")
                  assert.equal(
                      interval.toString(),
                      networkConfig[chainId]["keepersUpdateInterval"]
                  )
              })
          })

          describe("constructor", () => {
              it("reverts if you don't pay enough", async () => {
                  await expect(raffle.enterRaffle()).to.be.revertedWith(
                      "Raffle__SendMoreToEnterRaffle"
                  )
              })

              it("recors players when they enter", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  const playerFromContract = await raffle.getPlayer(0)
                  assert.equal(playerFromContract, deployer)
              })

              describe("enterRaffle", () => {
                  it("reverts when you don't pay enough", async () => {
                      await expect(raffle.enterRaffle()).to.be.revertedWith(
                          "Raffle__SendMoreToEnterRaffle"
                      )
                  })
                  it("recorde players when they enter", async () => {
                      await raffle.enterRaffle({
                          value: raffleEntranceFee,
                      })
                      const playerFromContract = await raffle.getPlayer(0)
                      assert.equal(playerFromContract.deployer)
                  })
                  it("emits event on enter", async () => {
                      await expect(
                          raffle.enterRaffle({
                              value: raffleEntranceFee,
                          })
                      ).to.emit(raffle, "RaffleEnter")
                  })
                  it("doesn't allow entrance when raffle is calculating", async () => {
                      await raffle.enterRaffle({
                          value: raffleEntranceFee,
                      })
                      // for a documentation of the methods below, go here: https://hardhat.org/hardhat-network/reference
                      await network.provider.send("evm_increaseTime", [
                          interval.toNumber() + 1,
                      ])
                      await network.provider.request({
                          method: "evm_mine",
                          params: [],
                      })
                      // we pretend to be a keeper for a second
                      await raffle.performUpkeep([]) // changes the state to calculating for our comparison below
                      await expect(
                          raffle.enterRaffle({
                              value: raffleEntranceFee,
                          })
                      ).to.be.revertedWith(
                          // is reverted as raffle is calculating
                          "Raffle__RaffleNotOpen"
                      )
                  })
              })
              describe("checkUpKeep", () => {
                  it("returns false if people haven't sent any ETH", async () => {
                      await network.provider.send("evm_increaseTime", [
                          interval.toNumber() + 1,
                      ])
                      await network.provider.send("evm_mine", [])
                      const { upkeepNeeded } =
                          await raffle.callStatic.checkUpkeep([])
                      assert(!upkeepNeeded)
                  })
                  it("returns false if raffle isn't open", async () => {
                      await raffle.enterRaffle({
                          value: raffleEntranceFee,
                      })
                      await network.provider.send("evm_increaseTime", [
                          interval.toNumber() + 1,
                      ])
                      await network.provider.send("evm_mine", [])
                      await raffle.performUpkeep([])
                      const raffleState = await raffle.getRaffleState()
                      const { upkeepNeeded } =
                          await raffle.callStatic.checkUpkeep([])
                      assert.equal(raffleState.toString(), "1")
                      assert.equal(upkeepNeeded, false)
                  })
                  it("returns false if enough time hasn't passed", async () => {
                      await raffle.enterRaffle({
                          value: raffleEntranceFee,
                      })
                      await network.provider.send("evm_increaseTime", [
                          interval.toNumber() - 2,
                      ])
                      await network.provider.request({
                          method: "evm_mine",
                          params: [],
                      })
                      const { upkeepNeeded } =
                          await raffle.callStatic.checkUpkeep("0x")
                      console.log(upkeepNeeded)
                      assert(!upkeepNeeded)
                  })

                  it("returns true if enough time hasn't passed, has players, eth, and is open", async () => {
                      await raffle.enterRaffle({
                          value: raffleEntranceFee,
                      })
                      await network.provider.send("evm_increaseTime", [
                          interval.toNumber() + 1,
                      ])
                      await network.provider.request({
                          method: "evm_mine",
                          params: [],
                      })
                      const { upkeepNeeded } =
                          await raffle.callStatic.checkUpkeep("0x")
                      assert(upkeepNeeded)
                  })
              })
              describe("performUpkeep", () => {
                  it("it can only run if checkupKeep is true", async () => {
                      await raffle.enterRaffle({
                          value: raffleEntranceFee,
                      })
                      await network.provider.send("evm_increaseTime", [
                          interval.toNumber() + 1,
                      ])
                      await network.provider.send("evm_mine", [])
                      const tx = await raffle.performUpkeep([])
                      assert(tx)
                  })

                  it("reverts when checkupkeep is false", async () => {
                      await expect(raffle.performUpkeep([])).to.be.revertedWith(
                          "Raffle__UpkeepNotNeeded"
                      )
                  })

                  it("updates the raffle state, emits an event, and calls the vrf coordinator", async () => {
                      await raffle.enterRaffle({
                          value: raffleEntranceFee,
                      })
                      await network.provider.send("evm_increaseTime", [
                          interval.toNumber() + 1,
                      ])
                      await network.provider.request({
                          method: "evm_mine",
                          params: [],
                      })
                      const txResponse = await raffle.performUpkeep([])
                      const txReceipt = await txResponse.wait(1)
                      const requestId = txReceipt.events[1].args.requestId
                      const raffleState = await raffle.getRaffleState()
                      assert(requestId.toNumber() > 0)
                      assert(raffleState.toString() == "1")
                  })
              })

              describe("fulfillRandomWords", () => {
                  beforeEach(async () => {
                      await raffle.enterRaffle({
                          value: raffleEntranceFee,
                      })
                      await network.provider.send("evm_increaseTime", [
                          interval.toNumber() + 1,
                      ])
                      await network.provider.request({
                          method: "evm_mine",
                          params: [],
                      })
                  })
                  it("can onyly be called after performUpKeep", async () => {
                      await expect(
                          vrfCoordinatorV2Mock.fulfillRandomWords(
                              0,
                              raffle.address
                          )
                      ).to.be.revertedWith("nonexistent request")
                      await expect(
                          vrfCoordinatorV2Mock.fulfillRandomWords(
                              1,
                              raffle.address
                          )
                      ).to.be.revertedWith("nonexistent request")
                  })

                  it("picks a winner, resets the lottery, and sends money", async () => {
                      const additionalEntrants = 3
                      const startingAccountIndex = 1 // deployer = 0
                      const accounts = await ethers.getSigners()

                      for (
                          let i = startingAccountIndex;
                          i < startingAccountIndex + additionalEntrants;
                          i++
                      ) {
                          const accountConnectedRaffle = raffle.connect(
                              accounts[i]
                          )
                          await accountConnectedRaffle.enterRaffle({
                              value: raffleEntranceFee,
                          })
                      }
                      const startingTimeStamp = await raffle.getLastTimeStamp()

                      //   performUpkeep (mock being chainlink keepers)
                      // fulfillRandomWords (mock being the chainlink VRF)
                      // We will have to wait for the fulfillRandomWords to be called
                      await new Promise(async (resolve, reject) => {
                          raffle.once("WinnerPicked", async () => {
                              console.log("WinnerPicked event fired!")
                              try {
                                  // Now lets get the ending values...
                                  const recentWinner =
                                      await raffle.getRecentWinner()
                                  const raffleState =
                                      await raffle.getRaffleState()
                                  const winnerBalance =
                                      await accounts[2].getBalance()
                                  const endingTimeStamp =
                                      await raffle.getLastTimeStamp()
                                  await expect(raffle.getPlayer(0)).to.be
                                      .reverted
                                  // Comparisons to check if our ending values are correct:
                                  assert.equal(
                                      recentWinner.toString(),
                                      accounts[2].address
                                  )
                                  assert.equal(raffleState, 0)
                                  assert.equal(
                                      winnerBalance.toString(),
                                      startingBalance // startingBalance + ( (raffleEntranceFee * additionalEntrances) + raffleEntranceFee )
                                          .add(
                                              raffleEntranceFee
                                                  .mul(additionalEntrances)
                                                  .add(raffleEntranceFee)
                                          )
                                          .toString()
                                  )
                                  assert(endingTimeStamp > startingTimeStamp)
                                  resolve() // if try passes, resolves the promise
                              } catch (e) {
                                  reject(e) // if try fails, rejects the promise
                              }
                          })
                      })
                      //   Setting up listener

                      // kicking off the event by mocking the chainlink keepers and vrf coordinator
                      const tx = await raffle.performUpkeep("0x")
                      const txReceipt = await tx.wait(1)
                      const startingBalance = await accounts[2].getBalance()
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          raffle.address
                      )
                  })
              })
          })
      })
