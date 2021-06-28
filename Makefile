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
	cd vexchange-lib && npm ci
	cd vexchange-v2-core && npm ci
	cd vexchange-v2-periphery && npm ci

# Compile contracts
compile:
	cd vexchange-lib && npm run compile
	cd vexchange-v2-core && npm run compile
	cd vexchange-v2-periphery && npm run compile

# Update dependencies and compile
build: install-deps compile

# Execute test suite
test: compile
	cd vexchange-lib && npm run test
	cd vexchange-v2-core && npm run test
	cd vexchange-v2-periphery && npm run test
