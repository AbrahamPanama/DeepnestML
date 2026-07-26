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
		}
	];
	var superpartClusteringRules = [
		{
			key: 'mergeLines',
			value: false,
			reason: 'Common-line merging is disabled while repeated parts are interlocked so every exported member keeps its exact cut path.'
		}
	];

	function cloneRules(rules){
		return rules.map(function(rule){
			return {
				key: rule.key,
				value: rule.value,
				reason: rule.reason
			};
		});
	}

	function rulesForContinuousCompaction(){
		return cloneRules(continuousCompactionRules);
	}

	function rulesForSuperpartClustering(){
		return cloneRules(superpartClusteringRules);
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

	function applySuperpartClustering(config, pairingActive){
		if(!config){
			return config;
		}
		if(config.placementType === 'steprepeat'){
			config.superpartClustering = false;
			return config;
		}
		if(config.superpartClustering !== true || pairingActive !== true){
			return config;
		}
		for(var i=0; i<superpartClusteringRules.length; i++){
			config[superpartClusteringRules[i].key] = superpartClusteringRules[i].value;
		}
		return config;
	}

	var api = {
		rulesForContinuousCompaction: rulesForContinuousCompaction,
		rulesForSuperpartClustering: rulesForSuperpartClustering,
		applyContinuousCompaction: applyContinuousCompaction,
		applyActiveContinuousCompaction: applyActiveContinuousCompaction,
		applySuperpartClustering: applySuperpartClustering
	};

	root.ConfigCompatibility = api;
	if(typeof module !== 'undefined' && module.exports){
		module.exports = api;
	}
}(typeof self !== 'undefined' ? self : this));
