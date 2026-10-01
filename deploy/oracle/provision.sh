#!/usr/bin/env bash
# Provision an Open Gather host on Oracle Cloud "Always Free" (Ampere A1, arm64).
# Creates (or reuses, by display name) a VCN, internet gateway, route table, security list, public subnet
# and one VM.Standard.A1.Flex instance with Ubuntu 24.04. Prints the public IP.
# Requires the OCI CLI configured (~/.oci/config). Stays inside the Always Free limits by default.
# usage: deploy/oracle/provision.sh [ssh-public-key-file] [ocpus] [memory-gb]
# OG_OCI_NAME names the VM; OG_OCI_NET names the network it joins (default: the VM name), so extra VMs
# (for example benchmark hosts) can share the demo's network.
# OG_OCI_SHAPE=VM.Standard.E2.1.Micro uses the always-free AMD micro VM (1 GB RAM) when Ampere A1 capacity
# is exhausted ("Out of host capacity" is common for A1 in busy regions; retrying later usually works).
set -euo pipefail
PUBKEY=${1:-$HOME/.ssh/open_gather_demo.pub}
OCPUS=${2:-2}
MEM=${3:-12}
NAME=${OG_OCI_NAME:-open-gather}
NET=${OG_OCI_NET:-$NAME}
SHAPE=${OG_OCI_SHAPE:-VM.Standard.A1.Flex}
C=${OG_OCI_COMPARTMENT:-$(awk -F= '/^tenancy/{print $2}' ~/.oci/config)}
q() { oci "$@" --output json; }
first() { python3 -c "import json,sys;d=sys.stdin.read();d=json.loads(d)['data'] if d.strip() else [];print(d[0]['id'] if d else '')"; }
id() { python3 -c "import json,sys;print(json.load(sys.stdin)['data']['id'])"; }

AD=$(q iam availability-domain list --compartment-id "$C" | python3 -c "import json,sys;print(json.load(sys.stdin)['data'][0]['name'])")

VCN=$(q network vcn list --compartment-id "$C" --display-name "$NET-vcn" --lifecycle-state AVAILABLE | first)
[ -n "$VCN" ] || VCN=$(q network vcn create --compartment-id "$C" --display-name "$NET-vcn" --cidr-blocks '["10.42.0.0/16"]' --dns-label opengather --wait-for-state AVAILABLE | id)

IGW=$(q network internet-gateway list --compartment-id "$C" --vcn-id "$VCN" --display-name "$NET-igw" | first)
[ -n "$IGW" ] || IGW=$(q network internet-gateway create --compartment-id "$C" --vcn-id "$VCN" --display-name "$NET-igw" --is-enabled true --wait-for-state AVAILABLE | id)

RT=$(q network route-table list --compartment-id "$C" --vcn-id "$VCN" --display-name "$NET-rt" | first)
[ -n "$RT" ] || RT=$(q network route-table create --compartment-id "$C" --vcn-id "$VCN" --display-name "$NET-rt" --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW\"}]" --wait-for-state AVAILABLE | id)

# HTTPS (Caddy), LiveKit ICE over TCP 7881, media UDP 7882, embedded TURN 3478/udp, SSH.
tcp() { echo "{\"protocol\":\"6\",\"source\":\"0.0.0.0/0\",\"tcpOptions\":{\"destinationPortRange\":{\"min\":$1,\"max\":$1}}}"; }
udp() { echo "{\"protocol\":\"17\",\"source\":\"0.0.0.0/0\",\"udpOptions\":{\"destinationPortRange\":{\"min\":$1,\"max\":$1}}}"; }
INGRESS="[$(tcp 22),$(tcp 80),$(tcp 443),$(tcp 7881),$(udp 7882),$(udp 3478)]"
EGRESS='[{"protocol":"all","destination":"0.0.0.0/0"}]'
SL=$(q network security-list list --compartment-id "$C" --vcn-id "$VCN" --display-name "$NET-sl" | first)
if [ -n "$SL" ]; then
  oci network security-list update --security-list-id "$SL" --ingress-security-rules "$INGRESS" --egress-security-rules "$EGRESS" --force >/dev/null
else
  SL=$(q network security-list create --compartment-id "$C" --vcn-id "$VCN" --display-name "$NET-sl" --ingress-security-rules "$INGRESS" --egress-security-rules "$EGRESS" --wait-for-state AVAILABLE | id)
fi

SUB=$(q network subnet list --compartment-id "$C" --vcn-id "$VCN" --display-name "$NET-subnet" | first)
[ -n "$SUB" ] || SUB=$(q network subnet create --compartment-id "$C" --vcn-id "$VCN" --display-name "$NET-subnet" --cidr-block 10.42.1.0/24 --route-table-id "$RT" --security-list-ids "[\"$SL\"]" --dns-label pub --wait-for-state AVAILABLE | id)

INST=$(q compute instance list --compartment-id "$C" --display-name "$NAME" --lifecycle-state RUNNING | first)
if [ -z "$INST" ]; then
  IMG=$(q compute image list --compartment-id "$C" --operating-system "Canonical Ubuntu" --operating-system-version 24.04 --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC | first)
  SHAPECFG=()
  [ "$SHAPE" = VM.Standard.A1.Flex ] && SHAPECFG=(--shape-config "{\"ocpus\":$OCPUS,\"memoryInGBs\":$MEM}")
  INST=$(q compute instance launch --compartment-id "$C" --availability-domain "$AD" --display-name "$NAME" \
    --shape "$SHAPE" ${SHAPECFG[@]+"${SHAPECFG[@]}"} \
    --image-id "$IMG" --subnet-id "$SUB" --assign-public-ip true --boot-volume-size-in-gbs 50 \
    --ssh-authorized-keys-file "$PUBKEY" --wait-for-state RUNNING | id)
fi
VNIC=$(q compute vnic-attachment list --compartment-id "$C" --instance-id "$INST" | python3 -c "import json,sys;print(json.load(sys.stdin)['data'][0]['vnic-id'])")
q network vnic get --vnic-id "$VNIC" | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['public-ip'])"
