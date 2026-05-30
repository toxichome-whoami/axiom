use redis::{
    streams::StreamClaimReply,
    AsyncCommands,
};

use crate::webhook::persistence::get_rt;

pub struct RedisDLQManager {
    redis_url: Option<String>,
    group: String,
    stream: String,
    dlq_stream: String,
    consumer_name: String,
}

impl RedisDLQManager {
    pub fn new() -> Self {
        RedisDLQManager {
            redis_url: None,
            group: "axiom_workers".to_string(),
            stream: "axiom_events".to_string(),
            dlq_stream: "axiom_events_dlq".to_string(),
            consumer_name: "dlq_reaper".to_string(),
        }
    }

    pub fn initialize(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        // dummy impl, as we removed the python dependency
        Ok(())
    }

    pub fn reap_dead_letters(&self, min_idle_time_ms: i64) -> Result<(), Box<dyn std::error::Error>> {
        let redis_url = match &self.redis_url {
            Some(url) => url.clone(),
            None => return Ok(()),
        };

        let stream = self.stream.clone();
        let group = self.group.clone();
        let dlq_stream = self.dlq_stream.clone();
        let consumer_name = self.consumer_name.clone();

        // Offload network I/O to the background Tokio runtime
        get_rt().spawn(async move {
            if let Ok(client) = redis::Client::open(redis_url) {
                if let Ok(mut con) = client.get_multiplexed_async_connection().await {
                    let pending_details: redis::RedisResult<Vec<(String, String, i64, i64)>> =
                        redis::cmd("XPENDING")
                            .arg(&stream)
                            .arg(&group)
                            .arg("-")
                            .arg("+")
                            .arg(100)
                            .query_async(&mut con)
                            .await;

                    if let Ok(details) = pending_details {
                        for (msg_id, _consumer, idle_time, deliveries) in details {
                            if idle_time >= min_idle_time_ms || deliveries >= 5 {
                                eprintln!("Event moved to DLQ: {}", msg_id);

                                let claim: redis::RedisResult<StreamClaimReply> =
                                    redis::cmd("XCLAIM")
                                        .arg(&stream)
                                        .arg(&group)
                                        .arg(&consumer_name)
                                        .arg(min_idle_time_ms)
                                        .arg(&msg_id)
                                        .query_async(&mut con)
                                        .await;

                                if let Ok(claimed) = claim {
                                    for stream_id in claimed.ids {
                                        // Copy payload map to DLQ
                                        let mut xadd_cmd = redis::cmd("XADD");
                                        xadd_cmd.arg(&dlq_stream).arg("*");
                                        for (k, v) in stream_id.map {
                                            if let Ok(v_bytes) =
                                                redis::from_redis_value::<Vec<u8>>(&v)
                                            {
                                                xadd_cmd.arg(k).arg(v_bytes);
                                            }
                                        }
                                        let _: redis::RedisResult<()> =
                                            xadd_cmd.query_async(&mut con).await;

                                        // Ack original
                                        let _: redis::RedisResult<()> =
                                            con.xack(&stream, &group, &[msg_id.clone()]).await;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        Ok(())
    }
}
