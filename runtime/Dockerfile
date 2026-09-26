FROM --platform=linux/arm64 ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive
ARG NORNS_REV=42df84420774ef4d0961cf37946ed30e4078920f
ARG AWAKE_REV=73d4accfc090aaab58f1586eaf4d9cf54d3cff01

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates cmake curl git iproute2 jackd2 \
    libasound2-dev libavahi-compat-libdnssd-dev libcairo2-dev libevdev-dev \
    libgpiod-dev libjack-jackd2-dev liblo-dev liblua5.3-dev libncurses5-dev \
    libncursesw5-dev libreadline-dev libsndfile1-dev libsdl2-dev libudev-dev \
    pkg-config python-is-python3 python3 python3-distutils supercollider-language supercollider-server \
    wget && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch v1.4.9 https://github.com/monome/libmonome.git /tmp/libmonome \
    && cd /tmp/libmonome && ./waf configure && ./waf && ./waf install && ldconfig

RUN git clone --depth 1 --branch v1.11 https://github.com/nanomsg/nng.git /tmp/nng \
    && cmake -S /tmp/nng -B /tmp/nng/build -G "Unix Makefiles" \
    && cmake --build /tmp/nng/build --parallel 2 \
    && cmake --install /tmp/nng/build && ldconfig

RUN useradd --create-home --shell /bin/bash we \
    && mkdir -p /home/we/dust/code /home/we/dust/data /home/we/dust/audio /frames \
    && chown -R we:we /home/we /frames

USER we
WORKDIR /home/we

COPY --chown=we:we runtime/patches/arm64-build.patch /tmp/norns-lab-arm64-build.patch

RUN git clone https://github.com/monome/norns.git norns \
    && cd norns && git checkout --detach "$NORNS_REV" \
    && git submodule update --init --recursive \
    && git apply /tmp/norns-lab-arm64-build.patch \
    && ./waf configure \
    && ./waf build \
    && mkdir -p /home/we/.local/share/SuperCollider/Extensions \
    && (cd sc && ./install.sh)

RUN git clone https://github.com/tehn/awake.git /home/we/dust/code/awake \
    && cd /home/we/dust/code/awake && git checkout --detach "$AWAKE_REV"

COPY --chown=we:we runtime/matronrc.lua /home/we/matronrc.lua
COPY --chown=we:we runtime/sclang_conf.yaml /home/we/.config/SuperCollider/sclang_conf.yaml
COPY --chown=we:we runtime/entrypoint.sh /usr/local/bin/norns-lab-runtime
COPY --chown=we:we runtime/versions.json /opt/norns-lab/versions.json
COPY --chown=we:we runtime/patches/arm64-build.patch /opt/norns-lab/arm64-build.patch
RUN chmod +x /usr/local/bin/norns-lab-runtime

ENV HOME=/home/we
USER root
EXPOSE 10111/udp
ENTRYPOINT ["/usr/local/bin/norns-lab-runtime"]
