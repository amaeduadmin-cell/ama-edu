// ============================================================
// LIVE UPDATES — subscribes to lightweight "this table changed"
// broadcasts (see notify_table_change() trigger in Supabase) and
// re-runs whichever reload function is currently displaying that
// data. No row data ever rides on these messages — just a signal to
// re-fetch — so this is safe on every table, including staff/
// students, without any risk of leaking password_hash or anything
// else via the payload (unlike raw Postgres Changes replication,
// which sends full rows and doesn't respect column-level grants).
//
// Lifecycle: every call to renderTab() tears down whichever
// subscriptions the PREVIOUS tab set up before building the new one,
// so there's never more than one tab's worth of live listeners
// active at a time, and switching tabs can't leak or stack channels.
// ============================================================

state.liveChannels = [];

function subscribeLive(tableName, callback) {
  const channel = sb.channel(tableName + "_changes")
    .on("broadcast", { event: "change" }, () => callback())
    .subscribe();
  state.liveChannels.push(channel);
  return channel;
}

function unsubscribeAllLive() {
  state.liveChannels.forEach(ch => { try { sb.removeChannel(ch); } catch (e) {} });
  state.liveChannels = [];
}
