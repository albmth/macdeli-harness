---
name: quant-research
description: Independently investigate a trading question with inherited evidence, executable experiments and honest economic evaluation.
---

Choose a question useful to the trading mission after reading relevant prior positive, negative and inconclusive evidence.
Compare a few candidate actions by economic usefulness, uncertainty reduction, effort and cost.
Do not repeat an unsuccessful experiment without a material change or select a strategy solely because it is easy to backtest.

Before execution, checkpoint a compact specification: question, mechanism, comparator, input manifest, as-of time, candidate code, evaluator, resource limit, expected output and stopping condition.
Use work_id/attempt_id directories and preserve the command, exit status, stdout/stderr and results.
Use actual data, causal timestamps, sensible chronological separation, transaction costs and useful baseline comparisons.
Retain labels such as diagnostic, development/exposed and prospective; previously exposed data is not an untouched holdout.
For a cheap diagnostic, keep the protocol brief and run it.

Keep candidate code separate from immutable authoritative inputs and evaluators.
Use NumPy, pandas, DuckDB, PyArrow, SciPy and inherited MacDeli numerical code where they fit.
Do not run pickle or other arbitrary serialized code on the Host.
A model explanation is a hypothesis, not evidence of improved returns.

For long-only spot signal work, evaluate_spot_signals replays published signals with the protected Engine and fixed costs, cash and single-entry comparisons.
Use an original 1m market export of at most 31 days and publish signals.json: {"schema_version":1,"market_artifact_ref":"export:<digest>","signals":[{"time":1704067260,"action":"enter"}]}.
Signal time is integer UTC epoch seconds at a candle close; actions are enter, exit or hold, with strictly increasing times.
This fixed accounting replay does not certify that candidate signal generation was causal or that a strategy is profitable.

Publish positive, negative, inconclusive and failed attempts.
Write manifest.json with work_id, attempt_id, question, outcome, command, resources, numerical results, limitations and files [{path,sha256,size_bytes}].
Files are regular files relative to the attempt directory; do not list manifest.json itself.
Include code, compact logs, results and the input manifest, retaining large data by its digest reference.
Call experiment_collect to copy the manifest and listed files from the remote work/attempt directory into protected staging.
Then call experiment_publish to preserve the received bytes immutably.

Finish the bounded investigation with an evidence-based conclusion and choose another useful action without an owner prompt.
When numerical work fails, diagnose from its actual output, adapt the code and retain failed evidence.
After two identical failures, change method, narrow the task or move to a more useful question.
A meaningful timed/event wait is valid, but uncertainty or a negative hypothesis does not suspend the mission.
