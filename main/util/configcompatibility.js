/*
 * Compatibility rules shared by the settings UI and active engine config.
 */

(function(root){
	'use strict';

	var continuousCompactionRules = [
		{
			key: 'localRefinement',
			value: true,
			reason: 'Continuous compaction requires Local refinement to stay enabled.'
		},
		{
			key: 'localRefinementEngine',
			value: 'smart',
			reason: 'Continuous compaction uses the Smart refinement engine.'
		},
		{
			key: 'processHoles',
			value: false,
			reason: 'Continuous compaction cannot process interior holes yet.'
		},
		{
			key: 'mergeLines',
			value: false,
			reason: 'Continuous compaction requires independent part edges, so common-line merging is unavailable.'
		}
	];

	function rulesForContinuousCompaction(){
		return continuousCompactionRules.map(function(rule){
			return {
				key: rule.key,
				value: rule.value,
				reason: rule.reason
			};
		});
	}

	function applyContinuousCompaction(config){
		if(!config || config.localRefinementContinuous !== true){
			return config;
		}
		for(var i=0; i<continuousCompactionRules.length; i++){
			config[continuousCompactionRules[i].key] = continuousCompactionRules[i].value;
		}
		return config;
	}

	function applyActiveContinuousCompaction(config){
		if(!config || config.localRefinement !== true){
			return config;
		}
		return applyContinuousCompaction(config);
	}

	var api = {
		rulesForContinuousCompaction: rulesForContinuousCompaction,
		applyContinuousCompaction: applyContinuousCompaction,
		applyActiveContinuousCompaction: applyActiveContinuousCompaction
	};

	root.ConfigCompatibility = api;
	if(typeof module !== 'undefined' && module.exports){
		module.exports = api;
	}
}(typeof self !== 'undefined' ? self : this));
