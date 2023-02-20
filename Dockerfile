# |==============================[ rapidsnark build stage ]=============================================|
# Build stage for rapidsnark
FROM node:16-buster-slim as rapidsnark-builder

# update global dependencies & add rapidsnark build dependencies
RUN apt-get update && apt-get install -y git curl build-essential libgmp-dev libsodium-dev nasm

# Build iden3/rapidsnark source
RUN git clone https://github.com/iden3/rapidsnark.git && \
    cd rapidsnark && \
    git submodule init && \
    git submodule update && \
    npm install && \
    npx task createFieldSources && \
    npx task buildProver

# |=================================[ canon build stage ]===============================================|
# Build stage for unirep source (custom branch checkout)
FROM node:16-buster-slim as sealer-builder

# update global dependencies & add build dependencies
RUN apt-get update && apt-get install -y git build-essential curl wget

# Copy from local source
COPY . /src
WORKDIR /src

RUN yarn

# Load unirep beta
RUN sh scripts/loadUnirepBeta.sh

# |=================================[ final stage ]===============================================|
FROM node:16-buster-slim as daemon

# Copy canon from canon-builder stage
COPY --from=sealer-builder /src /src

# Copy rapidsnark from rapidsnark-builder stage
COPY --from=rapidsnark-builder /rapidsnark/build/prover /usr/local/bin/rapidsnark

CMD ['node', '/src/src/daemon.mjs']
