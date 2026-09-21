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
# ContractorLink: dataset preparation and breach-risk prediction
**Elijah Njugi | Final-year project**

In this notebook, I examine the dataset used for the breach-risk prediction feature in ContractorLink. The aim is to identify tickets that may need attention before they miss their service deadline. I use a Random Forest classifier and compare its predictions with the recorded labels in a test set.

The notebook covers the dataset, preparation steps, model training and results. To run it in Colab, select **Runtime → Run all**. A free CPU runtime is enough. The research CSV is separate from the application's database and does not contain user passwords or uploaded project documents.
""")
cell("code", """
# Install the libraries needed to prepare the data, train the model and plot the results.
%pip -q install numpy==2.5.2 pandas==3.0.5 scikit-learn==1.9.0 joblib==1.5.3 matplotlib
""")
digest = hashlib.sha256((root / "ml/data/hybrid_breach_training.csv").read_bytes()).hexdigest()
cell("code", f"""
# Load the published dataset, check that the file is unchanged and preview its records.
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
## Where the data comes from
I use a dataset of 12,000 records: 6,000 initial incident snapshots drawn from the [UCI Incident Management Process Enriched Event Log](https://doi.org/10.24432/C57S4H) and 6,000 simulated records representing ContractorLink service scenarios. The preparation code is in `ml/prepare_hybrid_dataset.py`. A fixed random seed of 42 makes the sampling and simulation repeatable.

The `breached` column is the target: 1 represents a breach and 0 represents no breach. In this prepared dataset, all 1,530 breach labels come from the simulated records. The external labels use `made_sla` from the first incident snapshot, which may differ from the final outcome. The SLA target is also assigned from priority rather than taken from an actual agreement.

These details affect how I interpret the results. This experiment tests the model on the prepared mixture; it does not establish how well it will predict breaches in a real organization. I keep `record_source` for checking the data but leave it out of the model inputs. Other category differences may still allow the model to distinguish the two sources.
""")
cell("code", """
# Check the labels, missing values and repeated rows, then compare the two data sources.
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
## How I train the model
I use seven categorical features and three numeric features. Missing categorical values are replaced with the most frequent value, while missing numeric values are replaced with the median. One-hot encoding converts the categories into model inputs and allows the pipeline to handle unfamiliar categories. These preparation steps are fitted using only the training data.

I split the records into 80% for training and 20% for testing, keeping the breach proportion similar in both sets. The Random Forest uses 400 trees, a minimum of three samples per leaf and balanced class weights. I keep the random seed at 42 so the experiment can be repeated.

For evaluation, I look at precision, recall, F1 and ROC-AUC alongside the confusion matrix. I also compare accuracy with a simple baseline that predicts no breach for every record. This helps explain why accuracy alone is not enough for this dataset.
""")
training = (root / 'ml/train_breach_model.py').read_text(encoding='utf-8')
imports = training[training.index('import joblib'):training.index('ROOT =')]
features = training[training.index('FEATURES ='):training.index('\n\nif __name__')]
body = training.split('if __name__ == "__main__":\n', 1)[1]
body = '\n'.join(line[4:] if line.startswith('    ') else line for line in body.splitlines())
cell('code', '# Prepare the features, split the records, train the Random Forest and save the model.\n' + imports + '\nMODELS = Path("results"); MODELS.mkdir(exist_ok=True)\n' + features + '\n' + body)
cell('code', """
# Evaluate the test predictions and compare them with the no-breach baseline.
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
cell("markdown", """
## Discussion of the results
The project experiment produced a ROC-AUC of about 0.8403 and an accuracy of 69.96%. Breach precision was 28.13%, while breach recall was 87.25%. The confusion matrix was `[[1412, 682], [39, 267]]`: the model identified 267 of the 306 breach cases but also flagged 682 non-breach cases.

This means the model catches many of the labelled breaches, but it raises many false alarms. The baseline reaches 87.25% accuracy simply by predicting no breach, yet it misses every breach. I therefore treat the model score as a prompt to review a ticket, rather than a definite prediction that the ticket will miss its deadline.

There are also 6,227 duplicate rows across the columns retained in the CSV. Separate incidents can have the same values, but the original incident identifiers are not included, so I cannot check their independence from this file alone. Similar records can appear in both splits. Together with the simulated breach labels, this limits what the test results show.

For further evaluation, I would use final incident outcomes, retain incident identifiers for grouped splitting, check the SLA target mapping and align the training categories with the live application fields. Testing against independent ContractorLink outcomes would then give a stronger basis for judging the model's usefulness. The results here are from the dataset experiment, not an organization pilot.

## Saving the notebook and results
Select **File → Save a copy in Drive** to keep an editable notebook. The last cell creates a ZIP containing the dataset, trained model and metrics. Download it before ending the Colab session, since runtime files are temporary. Model files should only be loaded from a trusted source.
""")
cell('code', """
# Package the dataset, model and evaluation results for download.
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
