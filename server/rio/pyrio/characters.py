import csv
from .lookup import Lookup, LookupDicts, CAPTAINS
import sys
import os


charNameDict = {}
char_name_list = []

char_lookup = Lookup().lookup

def resource_path(relative_path):
    """ Get absolute path to resource, works for dev and for PyInstaller bundle """
    if hasattr(sys, '_MEIPASS'):
        # Running in PyInstaller bundle
        return os.path.join(sys._MEIPASS, relative_path)
    else:
        # Resolve relative to this file's directory
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), relative_path)

csv_path = resource_path("CharNames.csv")
with open(csv_path, "r") as file:
    reader = csv.reader(file)
    for row in reader:
        char_name_list.append(row)

# convert list of lists to kv objects format {<name>: <csv Index>}
for i, sublist in enumerate(char_name_list):
    for name in sublist:
        charNameDict[name] = i

def userInputToCharacter(userInput):
    userInput = userInput.replace(' ', '').lower()
    if userInput not in charNameDict.keys():
        raise Exception(f'{userInput} is an invalid character name')
    return char_lookup(LookupDicts.CHAR_NAME, charNameDict[userInput.lower()])

def is_captain(character):
    if userInputToCharacter(character) in CAPTAINS:
        return True
    
    return False

if __name__ == '__main__':
    print(userInputToCharacter('luigi'))