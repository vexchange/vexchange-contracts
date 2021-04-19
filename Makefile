####################################################################
# Vexchange v2
#
# Usage:
#  - 'build' will install and compile.
#  - 'test' will compile and run unit tests.
#  - 'all' (also default) will install, compile and test.
#
# Override the DEPS_PKG_MGR if needed. 
# (yarn may fail to correctly install dependencies on some systems)
####################################################################

# Package Manager: yarn or npm
DEPS_PKG_MGR=yarn
#DEPS_PKG_MGR=npm

# Default target - update dependencies and compile
all: install-deps test

# Update all dependencies
install-deps:
	cd uniswap-lib && $(DEPS_PKG_MGR) install --frozen-lockfile
	cd uniswap-v2-core && $(DEPS_PKG_MGR) install --frozen-lockfile
	cd uniswap-v2-periphery && $(DEPS_PKG_MGR) install --frozen-lockfile

# Compile contracts
compile:
	cd uniswap-lib && yarn compile
	cd uniswap-v2-core && yarn compile
	cd uniswap-v2-periphery && yarn compile

# Update dependencies and compile
build: install-deps compile

# Execute test suite
test: compile
	cd uniswap-lib && yarn test
	cd uniswap-v2-core && yarn test
	cd uniswap-v2-periphery && yarn test
