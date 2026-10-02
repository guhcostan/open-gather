#!/usr/bin/env python3
"""Cost model for a single-node Tilework deployment.

It contains NO prices. Every price is an input you must fill in from your provider's current price list.
Traffic inputs default to values measured or assumed in bench/RESULTS.md; override them with your own.

Example (all numbers below are HYPOTHETICAL inputs, not quotes):
  bench/cost.py --users 300 --vps-month 20 --media-vps-month 0 --egress-price-per-tb 1.0 --included-tb 20
"""
import argparse

p = argparse.ArgumentParser()
p.add_argument("--users", type=int, required=True, help="peak concurrent connected users")
p.add_argument("--hours-per-day", type=float, default=8, help="connected hours per user per workday")
p.add_argument("--workdays", type=float, default=21, help="workdays per month")
p.add_argument("--presence-kbps-per-user", type=float, default=None,
               help="app-server egress per connected user in kbit/s (default: 8*measured KB/s from --kb-per-client)")
p.add_argument("--kb-per-client", type=float, default=13.2,
               help="measured KB/s per client at ~500 users in one small map, 30%% walking (bench A-500-distributed)")
p.add_argument("--in-call", type=float, default=0.3, help="fraction of connected users in a conversation")
p.add_argument("--group-size", type=float, default=4, help="average people per conversation")
p.add_argument("--audio-kbps", type=float, default=32, help="Opus audio per publisher")
p.add_argument("--video-fraction", type=float, default=0.5, help="fraction of in-call users with camera on")
p.add_argument("--video-kbps", type=float, default=500, help="video per publisher as delivered to one subscriber")
p.add_argument("--vps-month", type=float, required=True, help="price/month of the app server (your currency)")
p.add_argument("--media-vps-month", type=float, default=0, help="price/month of a separate media server (0 if colocated)")
p.add_argument("--egress-price-per-tb", type=float, default=0, help="price per TB beyond the included quota")
p.add_argument("--included-tb", type=float, default=0, help="TB of egress included per month")
p.add_argument("--turn-share", type=float, default=0.15, help="fraction of media relayed through TURN (double-counts egress)")
p.add_argument("--backup-month", type=float, default=0, help="storage/backup cost per month")
a = p.parse_args()

hours = a.hours_per_day * a.workdays
pres_kbps = a.presence_kbps_per_user if a.presence_kbps_per_user is not None else a.kb_per_client * 8
pres_peak_mbps = a.users * pres_kbps / 1000

in_call = a.users * a.in_call
# In a group of k, each publisher's stream goes to (k-1) subscribers: SFU egress per publisher = (k-1)*rate
pubs_audio = in_call
pubs_video = in_call * a.video_fraction
media_kbps = (pubs_audio * a.audio_kbps + pubs_video * a.video_kbps) * (a.group_size - 1)
media_kbps *= 1 + a.turn_share
media_peak_mbps = media_kbps / 1000

def tb_month(mbps):  # sustained at peak for the connected hours (upper bound)
    return mbps / 8 * 3600 * hours / 1e6

pres_tb, media_tb = tb_month(pres_peak_mbps), tb_month(media_peak_mbps)
tot_tb = pres_tb + media_tb
overage = max(0.0, tot_tb - a.included_tb) * a.egress_price_per_tb
total = a.vps_month + a.media_vps_month + overage + a.backup_month
print(f"connected users (peak)         : {a.users}")
print(f"users in a call (assumed)      : {in_call:.0f}  (group size {a.group_size:g})")
print(f"presence egress @peak          : {pres_peak_mbps:.1f} Mbit/s   -> {pres_tb:.2f} TB/month (upper bound)")
print(f"media egress   @peak           : {media_peak_mbps:.1f} Mbit/s   -> {media_tb:.2f} TB/month (upper bound)")
print(f"total egress                   : {tot_tb:.2f} TB/month  (included {a.included_tb:g} TB)")
print(f"monthly cost                   : {total:.2f}  = servers {a.vps_month + a.media_vps_month:.2f} + overage {overage:.2f} + backup {a.backup_month:.2f}")
print(f"cost per connected user        : {total / a.users:.3f}")
if in_call:
    print(f"cost per user in a call        : {total / in_call:.3f}  (all cost attributed to callers; upper bound)")
print("NOTE: peak Mbit/s and TB/month are upper bounds (peak sustained for all connected hours). Only VPS capacity that was MEASURED counts as capacity.")
