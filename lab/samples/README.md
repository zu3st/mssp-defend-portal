# Lab sample documents

- `endpoint-package-malware-alert.json`: the official Elastic Defend alert sample from
  [elastic/endpoint-package](https://github.com/elastic/endpoint-package/blob/main/package/endpoint/data_stream/alerts/sample_event.json)
  (`package/endpoint/data_stream/alerts/sample_event.json`, a real "Malware Prevention Alert"
  captured from Elastic Endpoint). It is the template for malware alerts in
  `lab/feed-alerts.mjs`, which rewrites only its identity and timing fields.
