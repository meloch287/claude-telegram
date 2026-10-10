#!/bin/sh
set -eu
docker network inspect ai-workers >/dev/null 2>&1 || docker network create --subnet 172.30.0.0/24 --opt com.docker.network.bridge.name=aibr0 --opt com.docker.network.bridge.enable_icc=false ai-workers
# Controller-to-worker traffic stays on the local bridge, outside the proxy tunnel.
ip rule show | grep -q "to 172.30.0.0/24 lookup main" || ip rule add pref 10505 to 172.30.0.0/24 lookup main
# Keep rules in dedicated chains; never flush host-wide rules.
iptables -N AI-WORKER-EGRESS 2>/dev/null || true
iptables -F AI-WORKER-EGRESS
iptables -A AI-WORKER-EGRESS -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
for range in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 224.0.0.0/4 200.165.236.8/32; do
  iptables -A AI-WORKER-EGRESS -d "$range" -j REJECT
done
iptables -A AI-WORKER-EGRESS -j RETURN
iptables -C DOCKER-USER -s 172.30.0.0/24 -j AI-WORKER-EGRESS 2>/dev/null || iptables -I DOCKER-USER 1 -s 172.30.0.0/24 -j AI-WORKER-EGRESS
# Forward rules do not protect sockets on the host itself.
iptables -C INPUT -i aibr0 -j REJECT 2>/dev/null || iptables -I INPUT 1 -i aibr0 -j REJECT
# Replies to controller-initiated bb connections are allowed; tenants still cannot
# initiate connections to host services other than the scoped inference endpoint.
iptables -C INPUT -i aibr0 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -i aibr0 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# The only host endpoint exposed to workers is the scoped inference gateway.
iptables -C INPUT -i aibr0 -d 172.30.0.1 -p tcp --dport 8790 -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -i aibr0 -d 172.30.0.1 -p tcp --dport 8790 -j ACCEPT
