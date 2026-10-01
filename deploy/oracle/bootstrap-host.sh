#!/usr/bin/env bash
# Prepares a fresh Oracle Cloud Ubuntu 24.04 VM for the Open Gather Compose stack. Run ON the VM as a sudoer:
#   ssh ubuntu@IP "bash -s" < deploy/oracle/bootstrap-host.sh
# Idempotent: opens the host firewall (Oracle images reject everything but SSH), adds swap for 1 GB VMs and
# installs Docker with the Compose plugin.
set -euo pipefail

# 1) host firewall: insert ACCEPT rules before the image's final REJECT, then persist them.
open() { sudo iptables -C INPUT -p "$1" --dport "$2" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 -p "$1" --dport "$2" -j ACCEPT; }
open tcp 80; open tcp 443; open tcp 7881; open udp 7882; open udp 3478
sudo DEBIAN_FRONTEND=noninteractive apt-get -qq update
echo iptables-persistent iptables-persistent/autosave_v4 boolean true | sudo debconf-set-selections
echo iptables-persistent iptables-persistent/autosave_v6 boolean true | sudo debconf-set-selections
sudo DEBIAN_FRONTEND=noninteractive apt-get -qq install -y iptables-persistent >/dev/null
sudo netfilter-persistent save >/dev/null

# 2) swap: the always-free AMD micro VM has 1 GB of RAM.
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  grep -q /swapfile /etc/fstab || echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null
fi

# 3) Docker + Compose plugin from Ubuntu's archive.
if ! command -v docker >/dev/null; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get -qq install -y docker.io docker-compose-v2 >/dev/null
  sudo usermod -aG docker "$USER"
fi
sudo systemctl enable --now docker >/dev/null
echo "ready: $(docker --version) / $(docker compose version --short) / swap $(swapon --show --noheadings | awk '{print $3}')"
