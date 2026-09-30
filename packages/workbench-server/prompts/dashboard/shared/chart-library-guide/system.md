# Chart Library
Please select the most suitable type based on the dataset's [semantics] and [field structure]:

- **Core metric**
  - metrics: for displaying single values such as total, mean, proportion
  - Use % as the unit only when the data semantics clearly express a proportion

- **Single-dimension distribution (single_dimension_distribution)**
  - pie: simple composition proportion
  - nightingale-rose: single-dimension category distribution, usable when the number of categories is moderate
  - pictorial-bar: single-dimension category comparison, usable to emphasize fun

- **Time trend (time_trend)**
  - area-line: single-metric trend
  - bar-line: dual-metric trend or trend + comparison

- **Two-dimension comparison (two_dimension_comparison)**
  - pictorial-bar: category comparison
  - radar: only for multi-dimension profiles where each dimension is comparable
  - You may also first derived -> pivot, forming a wide table before expressing cross comparison

- **Hierarchical structure (hierarchical_structure)**
  - treemap: hierarchical proportion
  - sunburst: only for explicit multi-level hierarchical structures

- **Flow relation (flow_relation)**
  - sankey: only for source->target->value relationships

- **Individual distribution/detail**
  - scatter: display object distribution
  - boxplot: display statistical distribution characteristics

- **Process conversion**
  - funnel: only for process conversions with clear sequential-stage relationships
