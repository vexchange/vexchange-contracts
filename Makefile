####################################################################
# Vexchange v2
#
# Usage:
#  - 'build' will install and compile.
#  - 'test' will compile and run unit tests.
#  - 'all' (also default) will install, compile and test.
####################################################################

# Default target - update dependencies and compile
all: install-deps test

# Update all dependencies
install-deps:
	cd uniswap-lib && npm run install
	cd uniswap-v2-core && npm run install
	cd uniswap-v2-periphery && npm run install

# Compile contracts
compile:
	cd uniswap-lib && npm run compile
	cd uniswap-v2-core && npm run compile
	cd uniswap-v2-periphery && npm run compile

# Update dependencies and compile
build: install-deps compile

# Execute test suite
test: compile
	cd uniswap-lib && npm run test
	cd uniswap-v2-core && npm run test
	cd uniswap-v2-periphery && npm run test
