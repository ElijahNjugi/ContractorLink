"""Build the public, output-free research notebook from the project training code."""
from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parents[1]
cells = []
def cell(kind, text):
    item = {"cell_type": kind, "metadata": {}, "source": text.strip().splitlines(keepends=True)}
    if kind == "code":
        item.update(execution_count=None, outputs=[])
    cells.append(item)

cell("markdown", """
# ContractorLink: dataset exploration and breach-risk modelling
**Elijah Njugi — final-year project**

This notebook loads the project's published 12,000-row research dataset, checks its composition, and trains the same Random Forest configuration used by ContractorLink. Select **Runtime → Run all** in Google Colab. A free CPU runtime is sufficient; no paid GPU or application credentials are needed.

The research dataset is separate from the application database. It contains anonymized incident categories and simulated records, not ContractorLink account passwords, tickets or uploaded documents. Colab runtime files are temporary: download the exported results before ending the session.
""")
cell("code", """
%pip -q install numpy==2.5.2 pandas==3.0.5 scikit-learn==1.9.0 joblib==1.5.3 matplotlib
""")
digest = hashlib.sha256((root / "ml/data/hybrid_breach_training.csv").read_bytes()).hexdigest()
cell("code", f"""
from pathlib import Path
from urllib.request import urlopen
import hashlib, json
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from IPython.display import display

DATA_URL = 'https://raw.githubusercontent.com/ElijahNjugi/ContractorLink/5b965e36e21eac89c23c7368b19ea335ac3daa05/ml/data/hybrid_breach_training.csv'
payload = urlopen(DATA_URL, timeout=60).read()
assert hashlib.sha256(payload).hexdigest() == '{digest}', 'Dataset checksum mismatch'
DATA = Path('hybrid_breach_training.csv')
DATA.write_bytes(payload)
data = pd.read_csv(DATA)
print(f'Loaded {{len(data):,}} rows and {{len(data.columns)}} columns')
display(data.head(10))
""")
cell("markdown", """
## Provenance and interpretation
The external portion contains 6,000 sampled initial incident snapshots derived from the [UCI Incident Management Process Enriched Event Log](https://doi.org/10.24432/C57S4H). A further 6,000 records were simulated for ContractorLink scenarios with seed 42. The preparation procedure is available in `ml/prepare_hybrid_dataset.py` in the repository.

**All 1,530 positive breach labels in this prepared dataset come from simulated records.** External labels were taken from the initial snapshot's `made_sla` field, not the final incident outcome. The SLA target duration was assigned from priority, rather than measured from a real contractual deadline. These choices limit the validity of the dataset for predicting real operational breaches.

`record_source` is retained for auditing and excluded from model inputs. Differences in the other fields can still identify the source indirectly. A random holdout from this mixture is an internal experiment, not evidence of real-world or cross-organization performance. No interviews, organization pilot or formal user study is claimed here.
""")
cell("code", """
assert len(data) == 12000
assert set(data['breached'].unique()) == {0, 1}
display(pd.crosstab(data.record_source, data.breached, margins=True))
display(pd.DataFrame({'dtype': data.dtypes.astype(str), 'missing': data.isna().sum(), 'unique': data.nunique()}))
print('Duplicate rows:', int(data.duplicated().sum()))
print('Breach proportion:', round(data.breached.mean(), 4))
pd.crosstab(data.record_source, data.breached).plot.bar(stacked=True, rot=0, figsize=(9, 4))
plt.ylabel('Records'); plt.title('Labels by dataset source'); plt.tight_layout(); plt.show()
""")
cell("markdown", """
## Train and evaluate
Seven categorical and three numeric features enter the pipeline. Missing categorical values use the most frequent value; missing numeric values use the median. One-hot encoding ignores unseen categories. Preprocessing is fitted on the training split only.

The stratified 80/20 split uses seed 42. The forest has 400 trees, a minimum leaf size of 3, and balanced class weights. The evaluation reports a majority-class baseline alongside precision, recall, F1, ROC-AUC and the confusion matrix. Accuracy alone is misleading because most labels are negative.
""")
training = (root / 'ml/train_breach_model.py').read_text(encoding='utf-8')
imports = training[training.index('import joblib'):training.index('ROOT =')]
features = training[training.index('FEATURES ='):training.index('\n\nif __name__')]
body = training.split('if __name__ == "__main__":\n', 1)[1]
body = '\n'.join(line[4:] if line.startswith('    ') else line for line in body.splitlines())
cell('code', imports + '\nMODELS = Path("results"); MODELS.mkdir(exist_ok=True)\n' + features + '\n' + body)
cell('code', """
from sklearn.metrics import ConfusionMatrixDisplay, accuracy_score
predictions = model.predict(x_test)
print(classification_report(y_test, predictions, digits=4, zero_division=0))
print('ROC-AUC:', round(roc_auc_score(y_test, probabilities), 6))
print('Always non-breach baseline accuracy:', round(accuracy_score(y_test, np.zeros(len(y_test))), 6))
ConfusionMatrixDisplay.from_predictions(y_test, predictions, display_labels=['No breach', 'Breach'], cmap='Blues')
plt.title('Held-out evaluation (2,400 records)'); plt.tight_layout(); plt.show()
audit = pd.DataFrame({'source': data.loc[x_test.index, 'record_source'], 'actual': y_test, 'predicted': predictions})
display(audit.groupby('source').agg(rows=('actual', 'size'), actual_breaches=('actual', 'sum'), predicted_breaches=('predicted', 'sum')))
""")
cell('markdown', """
## What the results mean
The saved project experiment reported approximately 0.8403 ROC-AUC, 0.6996 accuracy, 0.2813 breach precision and 0.8725 breach recall. Its confusion matrix was `[[1412, 682], [39, 267]]`. The always-negative baseline has 87.25% accuracy but detects no breaches. The model's high recall comes with many false alarms; its score is advisory, not proof that a ticket will miss its SLA.

The prepared CSV also contains 6,227 duplicate rows across its retained columns. Different incidents may share those same values; original incident identifiers were not retained, so independence cannot be established from this CSV. Matching feature profiles can appear in both random splits, adding another limitation to interpretation.

Before operational validation, rebuild the external labels from final outcomes, retain identifiers for grouped splitting, verify the deadline mapping, align training categories with live application fields, and evaluate on independent real ContractorLink outcomes. Repeated incident snapshots must not cross training/test boundaries in future experiments. The current notebook reproduces the disclosed experiment without silently replacing its dataset or claiming improved results.

## Save your work
Use **File → Save a copy in Drive** to keep an editable copy in your Google account. The following optional cell downloads a ZIP containing the research dataset, trained model and metrics. Only load joblib model files from trusted sources.
""")
cell('code', """
import zipfile
with zipfile.ZipFile('ContractorLink_research_results.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.write(DATA)
    for file in sorted(MODELS.iterdir()):
        archive.write(file)
try:
    from google.colab import files
    files.download('ContractorLink_research_results.zip')
except ImportError:
    print('Saved ContractorLink_research_results.zip in the current directory.')
""")
notebook = {'cells': cells, 'metadata': {'colab': {'name': 'ContractorLink_Dataset_and_Model.ipynb'}, 'kernelspec': {'display_name': 'Python 3', 'language': 'python', 'name': 'python3'}, 'language_info': {'name': 'python'}}, 'nbformat': 4, 'nbformat_minor': 5}
for index, item in enumerate(cells):
    item['id'] = f'contractorlink-{index:02}'
target = root / 'notebooks/ContractorLink_Dataset_and_Model.ipynb'
target.parent.mkdir(exist_ok=True)
target.write_text(json.dumps(notebook, indent=2) + '\n', encoding='utf-8')
print(target)
