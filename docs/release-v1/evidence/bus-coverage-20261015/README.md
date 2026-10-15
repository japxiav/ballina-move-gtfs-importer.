# Bus visibility investigation — 15 October 2026

The public gateway supplied a real route22 bus toward Ballina at 01:32 London, with GPS at01:30:52. It was outside the initial Mayo viewport. Stored collector batches succeeded and preserved matching observations. No provider calls, collector triggers, clock overrides, fixture substitutions, secret changes or database writes were used in diagnosis.

The previous publication screenshot was not evidence of a broken bus collector: at14Oct08:35:33London, the latest stored batch had six vehicle observations whose GPS timestamps were185–191seconds old. All exceeded the unchanged180second freshness limit, so hiding them was correct. This diagnosis does not establish why a later batch was delayed, nor continuous availability.

The interface now reports separate bus/train counts for the active filter and calls these positions available in the feed, avoiding a national-coverage claim. Collapsed source details explain selected Ballina/Mayo route coverage, the three-minute bus GPS limit, and why no positions does not prove no running buses. Existing Show Ireland allows finding positions outside the viewport. Gateway, Edge functions, collectors, polling intervals and freshness limits remain byte-identical.

Management read-only execution could not invoke the protected get_live_vehicles RPC (permission denied); no grants were changed. The actual existing public gateway and direct bounded stored-row reads established the comparison instead.

Hosted shared-peer admission risk and regional launch gates remain unresolved. See publication evidence for the actual deployed version and browser result; a passing build is not publication proof.
