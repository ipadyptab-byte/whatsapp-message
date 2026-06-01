import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as XLSX from 'xlsx';
import { Contact } from './contact.entity';
import { ContactDto, ContactResponseDto } from './dto/import-contacts.dto';

@Injectable()
export class ContactService {
  constructor(
    @InjectRepository(Contact)
    private readonly contactRepository: Repository<Contact>,
  ) {}

  /**
   * Parse Excel/CSV file and extract contacts
   */
  parseExcelFile(buffer: Buffer): ContactDto[] {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data: any[] = XLSX.utils.sheet_to_json(worksheet);

      const contacts: ContactDto[] = [];
      for (const row of data) {
        // Support common column names
        const number = row.number || row.phone || row.phoneNumber || row.mobile || row.telepon;
        const name = row.name || row.nama || row.fullName || row.full_name || row.contactName;
        const notes = row.notes || row.catatan || row.description || row.keterangan;

        if (number) {
          // Clean the number - remove spaces, dashes, etc.
          const cleanNumber = String(number).replace(/[\s\-\(\)]/g, '');
          
          // Validate it looks like a phone number
          if (cleanNumber.length >= 8) {
            contacts.push({
              number: cleanNumber,
              name: name ? String(name) : undefined,
              notes: notes ? String(notes) : undefined,
            });
          }
        }
      }

      return contacts;
    } catch (error) {
      throw new BadRequestException(`Failed to parse Excel file: ${error.message}`);
    }
  }

  /**
   * Import contacts from array
   */
  async importContacts(sessionId: string, contacts: ContactDto[]): Promise<ContactResponseDto[]> {
    const results: ContactResponseDto[] = [];

    for (const contact of contacts) {
      try {
        // Check if contact already exists
        let existing = await this.contactRepository.findOne({
          where: { number: contact.number, sessionId },
        });

        if (existing) {
          // Update existing
          existing.name = contact.name || existing.name;
          existing.notes = contact.notes || existing.notes;
          await this.contactRepository.save(existing);
          results.push({
            number: contact.number,
            name: existing.name,
            notes: existing.notes,
            imported: true,
          });
        } else {
          // Create new
          const newContact = this.contactRepository.create({
            id: `${sessionId}_${contact.number}_${Date.now()}`,
            sessionId,
            number: contact.number,
            name: contact.name,
            notes: contact.notes,
            isWhatsAppUser: false,
          });
          await this.contactRepository.save(newContact);
          results.push({
            number: contact.number,
            name: newContact.name,
            notes: newContact.notes,
            imported: true,
          });
        }
      } catch (error) {
        results.push({
          number: contact.number,
          name: contact.name,
          notes: contact.notes,
          imported: false,
          error: error.message,
        });
      }
    }

    return results;
  }

  /**
   * Get all contacts for a session
   */
  async getContacts(sessionId: string): Promise<Contact[]> {
    return this.contactRepository.find({
      where: { sessionId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get a single contact
   */
  async getContact(id: string, sessionId: string): Promise<Contact> {
    const contact = await this.contactRepository.findOne({
      where: { id, sessionId },
    });
    if (!contact) {
      throw new NotFoundException(`Contact not found`);
    }
    return contact;
  }

  /**
   * Delete a contact
   */
  async deleteContact(id: string, sessionId: string): Promise<void> {
    const contact = await this.getContact(id, sessionId);
    await this.contactRepository.remove(contact);
  }

  /**
   * Update a contact
   */
  async updateContact(id: string, sessionId: string, data: Partial<Contact>): Promise<Contact> {
    const contact = await this.getContact(id, sessionId);
    Object.assign(contact, data);
    return this.contactRepository.save(contact);
  }

  /**
   * Search contacts
   */
  async searchContacts(sessionId: string, query: string): Promise<Contact[]> {
    return this.contactRepository
      .createQueryBuilder('contact')
      .where('contact.sessionId = :sessionId', { sessionId })
      .andWhere(
        '(contact.number LIKE :query OR contact.name LIKE :query OR contact.notes LIKE :query)',
        { query: `%${query}%` },
      )
      .orderBy('contact.createdAt', 'DESC')
      .getMany();
  }
}